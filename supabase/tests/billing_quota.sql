begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'quota@example.test', '',
  now(), now(), now()
);

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local role authenticated;

select is((public.account_snapshot()->>'plan')::text, 'free', 'new account starts free');
select is((public.account_snapshot()->>'freeBytesLimit')::bigint, 157286400::bigint, 'free limit is exactly 150 MiB');
select is(public.account_snapshot()->>'cycleEndsAt', null, 'cycle starts on first successful capture');

select public.cancel_capture_reservation((public.reserve_capture('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 512)->>'id')::uuid);
select is(public.account_snapshot()->>'cycleEndsAt', null, 'cancelled reservation does not start the cycle');

select ok((public.reserve_capture('22222222-2222-4222-8222-222222222222', 1024)->>'id') is not null, 'reserves exact bytes');
select is(
  public.reserve_capture('22222222-2222-4222-8222-222222222222', 1024)->>'id',
  public.reserve_capture('22222222-2222-4222-8222-222222222222', 1024)->>'id',
  'reservation is idempotent'
);

select public.commit_capture((
  select id from public.quota_reservations
  where operation_id = '22222222-2222-4222-8222-222222222222'
));
select is((public.account_snapshot()->>'freeBytesUsed')::bigint, 1024::bigint, 'commit consumes exact bytes once');
select public.commit_capture((
  select id from public.quota_reservations
  where operation_id = '22222222-2222-4222-8222-222222222222'
));
select is((public.account_snapshot()->>'freeBytesUsed')::bigint, 1024::bigint, 'duplicate commit does not double charge');

reset role;
update public.billing_accounts
set cycle_started_at = now() - interval '16 days', cycle_used_bytes = 42
where user_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select is((public.account_snapshot()->>'freeBytesUsed')::bigint, 0::bigint, 'cycle renews after exact 15-day intervals');

reset role;
update public.billing_accounts
set cycle_started_at = now(), cycle_used_bytes = 157286390
where user_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select ok((public.reserve_capture('33333333-3333-4333-8333-333333333333', 10)->>'id') is not null, 'allows the exact remaining quota');
select throws_ok(
  $$select public.reserve_capture('44444444-4444-4444-8444-444444444444', 1)$$,
  'P0001', 'quota-exceeded', 'blocks one byte over the free quota'
);

reset role;
insert into public.paypal_checkouts (paypal_id, user_id, kind, amount_cents)
values
  ('order-1', '11111111-1111-4111-8111-111111111111', 'support', 400),
  ('order-2', '11111111-1111-4111-8111-111111111111', 'support', 500);
select ok(public.apply_paypal_event(
  'event-1', 'PAYMENT.CAPTURE.COMPLETED', 'support-payment',
  '11111111-1111-4111-8111-111111111111', 'payment-1', null, 'order-1', 400, null, null
), 'verified support event is applied');
select is(public.apply_paypal_event(
  'event-1', 'PAYMENT.CAPTURE.COMPLETED', 'support-payment',
  '11111111-1111-4111-8111-111111111111', 'payment-1', null, 'order-1', 400, null, null
), false, 'duplicate webhook event is ignored');
select ok((select support_benefit_used from public.billing_accounts where user_id = '11111111-1111-4111-8111-111111111111'), 'support benefit is marked as used');
select is((select count(*) from public.premium_grants where source = 'support'), 1::bigint, 'first qualifying support creates one grant');
select ok(public.apply_paypal_event(
  'event-2', 'PAYMENT.CAPTURE.COMPLETED', 'support-payment',
  '11111111-1111-4111-8111-111111111111', 'payment-2', null, 'order-2', 500, null, null
), 'later support is still accepted');
select is((select count(*) from public.premium_grants where source = 'support'), 1::bigint, 'support benefit is granted only once');
set local role authenticated;
select is(public.account_snapshot()->>'plan', 'premium', 'active grant enables Premium');
select ok((public.reserve_capture('55555555-5555-4555-8555-555555555555', 209715200)->>'id') is not null, 'Premium has no account quota');

select * from finish();
rollback;
