import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { corsHeaders, json, requiredEnv } from '../_shared/http.ts';
import { approvalUrl, paypalRequest, type PayPalLink } from '../_shared/paypal.ts';

interface RequestBody {
  action?: unknown;
  operationId?: unknown;
  reservationId?: unknown;
  bytes?: unknown;
  kind?: unknown;
  amountCents?: unknown;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'unexpected-error';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'authentication-required' }, 401);
    const url = requiredEnv('SUPABASE_URL');
    const userClient = createClient(url, requiredEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const serviceClient = createClient(url, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user || !authData.user.email_confirmed_at) {
      return json({ error: 'verified-account-required' }, 401);
    }

    const body = await request.json() as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'snapshot') {
      const { data, error } = await userClient.rpc('account_snapshot');
      if (error) throw error;
      return json(data);
    }

    if (action === 'reserve') {
      const bytes = Number(body.bytes);
      if (!uuidPattern.test(String(body.operationId)) || !Number.isSafeInteger(bytes) || bytes <= 0) {
        return json({ error: 'invalid-reservation' }, 400);
      }
      const { data, error } = await userClient.rpc('reserve_capture', {
        p_operation_id: body.operationId,
        p_bytes: bytes,
      });
      if (error) throw error;
      return json(data);
    }

    if (action === 'commit' || action === 'reconcile') {
      if (!uuidPattern.test(String(body.reservationId))) return json({ error: 'invalid-reservation' }, 400);
      const { data, error } = await userClient.rpc('commit_capture', {
        p_reservation_id: body.reservationId,
      });
      if (error) throw error;
      return json(data);
    }

    if (action === 'cancel-reservation') {
      if (!uuidPattern.test(String(body.reservationId))) return json({ error: 'invalid-reservation' }, 400);
      const { error } = await userClient.rpc('cancel_capture_reservation', {
        p_reservation_id: body.reservationId,
      });
      if (error) throw error;
      return json({ cancelled: true });
    }

    if (action === 'create-checkout') {
      const kind = body.kind === 'premium' || body.kind === 'support' ? body.kind : undefined;
      if (!kind) return json({ error: 'invalid-checkout-kind' }, 400);
      const { data: subscription } = await serviceClient
        .from('subscriptions')
        .select('status')
        .eq('user_id', authData.user.id)
        .maybeSingle();
      const hasMonthlyPlan = ['approval-pending', 'active', 'past-due'].includes(subscription?.status ?? '');
      if (hasMonthlyPlan) return json({ error: 'monthly-subscription-already-active' }, 409);

      if (kind === 'premium') {
        const result = await paypalRequest<{ id: string; links?: PayPalLink[] }>('/v1/billing/subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            plan_id: requiredEnv('PAYPAL_PLAN_ID'),
            custom_id: authData.user.id,
            application_context: {
              brand_name: 'Colección Web PDF',
              user_action: 'SUBSCRIBE_NOW',
              return_url: requiredEnv('PAYPAL_RETURN_URL'),
              cancel_url: requiredEnv('PAYPAL_CANCEL_URL'),
            },
          }),
        });
        const { error } = await serviceClient.from('subscriptions').upsert({
          user_id: authData.user.id,
          paypal_subscription_id: result.id,
          status: 'approval-pending',
        });
        if (error) throw error;
        return json({ checkoutUrl: approvalUrl(result.links) });
      }

      const amountCents = Number(body.amountCents);
      if (!Number.isSafeInteger(amountCents) || amountCents < 400 || amountCents > 1_000_000) {
        return json({ error: 'support-must-be-between-4-and-10000-usd' }, 400);
      }
      const result = await paypalRequest<{ id: string; links?: PayPalLink[] }>('/v2/checkout/orders', {
        method: 'POST',
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            custom_id: authData.user.id,
            description: 'Apoyo a Colección Web PDF',
            amount: { currency_code: 'USD', value: (amountCents / 100).toFixed(2) },
          }],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'Colección Web PDF',
                user_action: 'PAY_NOW',
                return_url: requiredEnv('PAYPAL_RETURN_URL'),
                cancel_url: requiredEnv('PAYPAL_CANCEL_URL'),
              },
            },
          },
        }),
      });
      const { error } = await serviceClient.from('paypal_checkouts').insert({
        paypal_id: result.id,
        user_id: authData.user.id,
        kind: 'support',
        amount_cents: amountCents,
      });
      if (error) throw error;
      return json({ checkoutUrl: approvalUrl(result.links) });
    }

    if (action === 'cancel-subscription') {
      const { data: subscription, error: lookupError } = await serviceClient
        .from('subscriptions')
        .select('paypal_subscription_id,status')
        .eq('user_id', authData.user.id)
        .single();
      if (lookupError || !subscription) return json({ error: 'subscription-not-found' }, 404);
      if (!['cancelled', 'expired'].includes(subscription.status)) {
        await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(subscription.paypal_subscription_id)}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Cancelación solicitada por el usuario' }),
        });
        const { error } = await serviceClient.from('subscriptions').update({
          status: 'cancelled',
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
        }).eq('user_id', authData.user.id);
        if (error) throw error;
      }
      const { data, error } = await userClient.rpc('account_snapshot');
      if (error) throw error;
      return json(data);
    }

    return json({ error: 'unknown-action' }, 400);
  } catch (error) {
    return json({ error: errorMessage(error) }, 400);
  }
});
