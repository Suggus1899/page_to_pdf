import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { json, requiredEnv } from '../_shared/http.ts';
import { paypalRequest } from '../_shared/paypal.ts';

interface WebhookEvent {
  id?: unknown;
  event_type?: unknown;
  resource?: Record<string, unknown>;
}

interface SubscriptionDetails {
  id: string;
  custom_id?: string;
  status?: string;
  billing_info?: { next_billing_time?: string };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stringAt(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function subscriptionStatus(eventType: string): string {
  if (eventType.endsWith('.ACTIVATED')) return 'active';
  if (eventType.endsWith('.CANCELLED')) return 'cancelled';
  if (eventType.endsWith('.SUSPENDED')) return 'suspended';
  if (eventType.endsWith('.EXPIRED')) return 'expired';
  if (eventType.endsWith('.PAYMENT.FAILED')) return 'past-due';
  return 'approval-pending';
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  try {
    const event = await request.json() as WebhookEvent;
    const eventId = typeof event.id === 'string' ? event.id : '';
    const eventType = typeof event.event_type === 'string' ? event.event_type : '';
    if (!eventId || !eventType || !event.resource) return json({ error: 'invalid-event' }, 400);

    const verification = await paypalRequest<{ verification_status?: string }>('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify({
        auth_algo: request.headers.get('paypal-auth-algo'),
        cert_url: request.headers.get('paypal-cert-url'),
        transmission_id: request.headers.get('paypal-transmission-id'),
        transmission_sig: request.headers.get('paypal-transmission-sig'),
        transmission_time: request.headers.get('paypal-transmission-time'),
        webhook_id: requiredEnv('PAYPAL_WEBHOOK_ID'),
        webhook_event: event,
      }),
    });
    if (verification.verification_status !== 'SUCCESS') return json({ error: 'invalid-signature' }, 401);

    const serviceClient = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let action = 'ignore';
    let userId = stringAt(event.resource, 'custom_id');
    let paymentId: string | undefined;
    let subscriptionId: string | undefined;
    let orderId: string | undefined;
    let amountCents: number | undefined;
    let periodEnd: string | undefined;
    let status: string | undefined;

    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      orderId = stringAt(event.resource, 'id');
      if (orderId) {
        await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });
        await serviceClient.from('paypal_checkouts').update({ status: 'approved' }).eq('paypal_id', orderId);
      }
    } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      action = 'support-payment';
      paymentId = stringAt(event.resource, 'id');
      const supplementary = event.resource.supplementary_data as Record<string, unknown> | undefined;
      const relatedIds = supplementary?.related_ids as Record<string, unknown> | undefined;
      orderId = stringAt(relatedIds, 'order_id');
      const amount = event.resource.amount as Record<string, unknown> | undefined;
      amountCents = Math.round(Number(amount?.value) * 100);
      if (!paymentId || !orderId || !Number.isSafeInteger(amountCents)) throw new Error('Incomplete support payment event');
    } else if (eventType === 'PAYMENT.SALE.COMPLETED') {
      action = 'subscription-payment';
      paymentId = stringAt(event.resource, 'id');
      subscriptionId = stringAt(event.resource, 'billing_agreement_id');
      if (subscriptionId) {
        const details = await paypalRequest<SubscriptionDetails>(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
        userId = details.custom_id;
        periodEnd = details.billing_info?.next_billing_time;
      }
      if (!paymentId || !subscriptionId || !periodEnd) throw new Error('Incomplete subscription payment event');
    } else if (eventType.startsWith('BILLING.SUBSCRIPTION.')) {
      action = 'subscription-status';
      subscriptionId = stringAt(event.resource, 'id');
      periodEnd = stringAt(event.resource.billing_info as Record<string, unknown> | undefined, 'next_billing_time');
      status = subscriptionStatus(eventType);
    } else if (
      eventType === 'PAYMENT.CAPTURE.REFUNDED'
      || eventType === 'PAYMENT.CAPTURE.REVERSED'
      || eventType === 'PAYMENT.SALE.REFUNDED'
      || eventType === 'PAYMENT.SALE.REVERSED'
    ) {
      action = 'reversal';
      paymentId = stringAt(event.resource, 'sale_id') ?? stringAt(event.resource, 'capture_id');
      const supplementary = event.resource.supplementary_data as Record<string, unknown> | undefined;
      const relatedIds = supplementary?.related_ids as Record<string, unknown> | undefined;
      paymentId ??= stringAt(relatedIds, 'capture_id');
      if (!paymentId) throw new Error('Reversal does not reference the original payment');
    }

    if (userId && !uuidPattern.test(userId)) userId = undefined;
    const { error } = await serviceClient.rpc('apply_paypal_event', {
      p_event_id: eventId,
      p_event_type: eventType,
      p_action: action,
      p_user_id: userId ?? null,
      p_provider_payment_id: paymentId ?? null,
      p_subscription_id: subscriptionId ?? null,
      p_order_id: orderId ?? null,
      p_amount_cents: Number.isSafeInteger(amountCents) ? amountCents : null,
      p_period_end: periodEnd ?? null,
      p_subscription_status: status ?? null,
    });
    if (error) throw error;
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unexpected-error';
    return json({ error: message }, 400);
  }
});
