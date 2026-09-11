create extension if not exists pgcrypto;

create table public.billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cycle_started_at timestamptz,
  cycle_used_bytes bigint not null default 0 check (cycle_used_bytes >= 0),
  support_benefit_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quota_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  bytes bigint not null check (bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'committed', 'cancelled')),
  counts_toward_quota boolean not null,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (user_id, operation_id)
);

create index quota_reservations_pending_idx
  on public.quota_reservations (user_id, expires_at)
  where status = 'pending';

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  paypal_subscription_id text not null unique,
  status text not null check (status in ('approval-pending', 'active', 'past-due', 'cancelled', 'suspended', 'expired')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.paypal_checkouts (
  paypal_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('premium', 'support')),
  amount_cents integer check (amount_cents is null or amount_cents >= 400),
  status text not null default 'created' check (status in ('created', 'approved', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table public.premium_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('subscription', 'support')),
  provider_payment_id text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index premium_grants_active_idx
  on public.premium_grants (user_id, ends_at)
  where revoked_at is null;

create table public.paypal_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.billing_accounts enable row level security;
alter table public.quota_reservations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.paypal_checkouts enable row level security;
alter table public.premium_grants enable row level security;
alter table public.paypal_events enable row level security;

create policy "read own billing account" on public.billing_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own reservations" on public.quota_reservations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own subscription" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own grants" on public.premium_grants
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.create_billing_account()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.billing_accounts (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_billing_account();

insert into public.billing_accounts (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.roll_quota_cycle(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_started timestamptz;
  v_intervals integer;
begin
  select cycle_started_at into v_started
  from public.billing_accounts where user_id = p_user_id for update;

  if v_started is null then
    return;
  end if;

  v_intervals := floor(extract(epoch from (now() - v_started)) / 1296000)::integer;
  if v_intervals > 0 then
    update public.billing_accounts
    set cycle_started_at = v_started + (v_intervals * interval '15 days'),
        cycle_used_bytes = 0,
        updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.account_snapshot()
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.billing_accounts%rowtype;
  v_premium_until timestamptz;
  v_subscription_status text;
begin
  if v_user_id is null then raise exception 'authentication-required' using errcode = '28000'; end if;
  insert into public.billing_accounts (user_id) values (v_user_id) on conflict do nothing;
  perform public.roll_quota_cycle(v_user_id);
  select * into v_account from public.billing_accounts where user_id = v_user_id;
  select max(ends_at) into v_premium_until
    from public.premium_grants
    where user_id = v_user_id and revoked_at is null and ends_at > now();
  select status into v_subscription_status from public.subscriptions where user_id = v_user_id;

  return jsonb_build_object(
    'plan', case when v_premium_until is not null then 'premium' else 'free' end,
    'freeBytesLimit', 157286400,
    'freeBytesUsed', v_account.cycle_used_bytes,
    'cycleStartedAt', v_account.cycle_started_at,
    'cycleEndsAt', case when v_account.cycle_started_at is null then null else v_account.cycle_started_at + interval '15 days' end,
    'premiumUntil', v_premium_until,
    'subscriptionStatus', coalesce(v_subscription_status, 'none'),
    'supportBenefitUsed', v_account.support_benefit_used
  );
end;
$$;

create or replace function public.reserve_capture(p_operation_id uuid, p_bytes bigint)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.billing_accounts%rowtype;
  v_existing public.quota_reservations%rowtype;
  v_reserved bigint;
  v_premium boolean;
  v_result public.quota_reservations%rowtype;
begin
  if v_user_id is null then raise exception 'authentication-required' using errcode = '28000'; end if;
  if p_bytes <= 0 or p_bytes > 314572800 then raise exception 'invalid-capture-size' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = v_user_id and email_confirmed_at is not null) then
    raise exception 'email-not-verified' using errcode = '28000';
  end if;

  insert into public.billing_accounts (user_id) values (v_user_id) on conflict do nothing;
  select * into v_account from public.billing_accounts where user_id = v_user_id for update;
  perform public.roll_quota_cycle(v_user_id);
  select * into v_account from public.billing_accounts where user_id = v_user_id;

  select * into v_existing from public.quota_reservations
    where user_id = v_user_id and operation_id = p_operation_id;
  if found then
    if v_existing.bytes <> p_bytes then raise exception 'operation-size-mismatch' using errcode = '22023'; end if;
    return jsonb_build_object('id', v_existing.id, 'operationId', v_existing.operation_id, 'bytes', v_existing.bytes, 'expiresAt', v_existing.expires_at);
  end if;

  select exists(
    select 1 from public.premium_grants
    where user_id = v_user_id and revoked_at is null and ends_at > now()
  ) into v_premium;

  if not v_premium then
    select coalesce(sum(bytes), 0) into v_reserved
      from public.quota_reservations
      where user_id = v_user_id and status = 'pending' and expires_at > now() and counts_toward_quota;
    if v_account.cycle_used_bytes + v_reserved + p_bytes > 157286400 then
      raise exception 'quota-exceeded' using errcode = 'P0001';
    end if;
  end if;

  insert into public.quota_reservations (user_id, operation_id, bytes, counts_toward_quota)
  values (v_user_id, p_operation_id, p_bytes, not v_premium)
  returning * into v_result;
  return jsonb_build_object('id', v_result.id, 'operationId', v_result.operation_id, 'bytes', v_result.bytes, 'expiresAt', v_result.expires_at);
end;
$$;

create or replace function public.commit_capture(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.quota_reservations%rowtype;
  v_account public.billing_accounts%rowtype;
  v_reserved bigint;
  v_premium boolean;
begin
  if v_user_id is null then raise exception 'authentication-required' using errcode = '28000'; end if;
  select * into v_reservation from public.quota_reservations
    where id = p_reservation_id and user_id = v_user_id for update;
  if not found then raise exception 'reservation-not-found' using errcode = 'P0002'; end if;
  if v_reservation.status = 'cancelled' then raise exception 'reservation-cancelled' using errcode = 'P0001'; end if;
  if v_reservation.status = 'committed' then return public.account_snapshot(); end if;

  select * into v_account from public.billing_accounts where user_id = v_user_id for update;
  perform public.roll_quota_cycle(v_user_id);
  select * into v_account from public.billing_accounts where user_id = v_user_id;
  select exists(
    select 1 from public.premium_grants
    where user_id = v_user_id and revoked_at is null and ends_at > now()
  ) into v_premium;

  if not v_premium then
    select coalesce(sum(bytes), 0) into v_reserved
      from public.quota_reservations
      where user_id = v_user_id and id <> p_reservation_id and status = 'pending'
        and expires_at > now() and counts_toward_quota;
    if v_account.cycle_started_at is null then
      update public.billing_accounts set cycle_started_at = now(), updated_at = now() where user_id = v_user_id;
    end if;
    if v_account.cycle_used_bytes + v_reserved + v_reservation.bytes > 157286400 then
      raise exception 'quota-exceeded' using errcode = 'P0001';
    end if;
    update public.billing_accounts
      set cycle_used_bytes = cycle_used_bytes + v_reservation.bytes, updated_at = now()
      where user_id = v_user_id;
  end if;

  update public.quota_reservations
    set status = 'committed', committed_at = now(), counts_toward_quota = not v_premium
    where id = p_reservation_id;
  return public.account_snapshot();
end;
$$;

create or replace function public.cancel_capture_reservation(p_reservation_id uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.quota_reservations set status = 'cancelled'
  where id = p_reservation_id and user_id = auth.uid() and status = 'pending';
$$;

create or replace function public.apply_paypal_event(
  p_event_id text,
  p_event_type text,
  p_action text,
  p_user_id uuid,
  p_provider_payment_id text,
  p_subscription_id text,
  p_order_id text,
  p_amount_cents integer,
  p_period_end timestamptz,
  p_subscription_status text
)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_active_subscription boolean;
  v_starts_at timestamptz;
begin
  insert into public.paypal_events (event_id, event_type) values (p_event_id, p_event_type)
  on conflict do nothing;
  if not found then return false; end if;

  if v_user_id is null and p_order_id is not null then
    select user_id into v_user_id from public.paypal_checkouts where paypal_id = p_order_id;
  end if;
  if v_user_id is null and p_subscription_id is not null then
    select user_id into v_user_id from public.subscriptions where paypal_subscription_id = p_subscription_id;
  end if;
  if v_user_id is not null then
    insert into public.billing_accounts (user_id) values (v_user_id) on conflict do nothing;
    perform 1 from public.billing_accounts where user_id = v_user_id for update;
  end if;

  if p_action = 'subscription-status' and v_user_id is not null and p_subscription_id is not null then
    insert into public.subscriptions (user_id, paypal_subscription_id, status, current_period_end, cancel_at_period_end)
    values (v_user_id, p_subscription_id, p_subscription_status, p_period_end, p_subscription_status = 'cancelled')
    on conflict (user_id) do update set
      paypal_subscription_id = excluded.paypal_subscription_id,
      status = excluded.status,
      current_period_end = coalesce(excluded.current_period_end, public.subscriptions.current_period_end),
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = now();
  elsif p_action = 'subscription-payment' and v_user_id is not null and p_provider_payment_id is not null and p_period_end is not null then
    insert into public.premium_grants (user_id, source, provider_payment_id, starts_at, ends_at)
    values (v_user_id, 'subscription', p_provider_payment_id, now(), p_period_end)
    on conflict (provider_payment_id) do nothing;
  elsif p_action = 'support-payment' and v_user_id is not null and p_provider_payment_id is not null and p_amount_cents >= 400 then
    select exists(
      select 1 from public.subscriptions
      where user_id = v_user_id and status in ('approval-pending', 'active', 'past-due')
    ) into v_active_subscription;
    update public.paypal_checkouts set status = 'completed' where paypal_id = p_order_id;
    if not v_active_subscription and not (select support_benefit_used from public.billing_accounts where user_id = v_user_id) then
      update public.billing_accounts set support_benefit_used = true, updated_at = now() where user_id = v_user_id;
      select greatest(now(), coalesce(max(ends_at), now())) into v_starts_at
        from public.premium_grants
        where user_id = v_user_id and revoked_at is null;
      insert into public.premium_grants (user_id, source, provider_payment_id, starts_at, ends_at)
      values (v_user_id, 'support', p_provider_payment_id, v_starts_at, v_starts_at + interval '3 months')
      on conflict (provider_payment_id) do nothing;
    end if;
  elsif p_action = 'reversal' and p_provider_payment_id is not null then
    update public.premium_grants set revoked_at = now()
    where provider_payment_id = p_provider_payment_id and revoked_at is null;
  end if;
  return true;
end;
$$;

revoke all on function public.roll_quota_cycle(uuid) from public, anon, authenticated;
revoke all on function public.apply_paypal_event(text,text,text,uuid,text,text,text,integer,timestamptz,text) from public, anon, authenticated;
revoke all on function public.account_snapshot() from public, anon;
revoke all on function public.reserve_capture(uuid,bigint) from public, anon;
revoke all on function public.commit_capture(uuid) from public, anon;
revoke all on function public.cancel_capture_reservation(uuid) from public, anon;
grant execute on function public.account_snapshot() to authenticated;
grant execute on function public.reserve_capture(uuid,bigint) to authenticated;
grant execute on function public.commit_capture(uuid) to authenticated;
grant execute on function public.cancel_capture_reservation(uuid) to authenticated;
grant execute on function public.apply_paypal_event(text,text,text,uuid,text,text,text,integer,timestamptz,text) to service_role;
