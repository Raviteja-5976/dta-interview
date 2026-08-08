/**
 * POST /api/payments/webhook — Razorpay's server-to-server callback.
 *
 * This is the source of truth for whether a payment happened. It fires whether
 * or not the user's browser survived the redirect, which is the whole point.
 *
 * Three things this route must get right:
 *   1. Verify against the RAW body. Parsing first changes the bytes and the
 *      HMAC will never match.
 *   2. Be idempotent. Razorpay retries on any non-2xx, and payment.authorized /
 *      payment.captured are explicitly documented as arriving out of order.
 *   3. Return 2xx for anything it has handled or intends to ignore. A 500 on an
 *      event we do not care about earns a retry storm.
 *
 * There is no auth on this route by design — the signature IS the auth. It is
 * excluded from the proxy's protected prefixes accordingly.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyWebhookSignature,
  type RazorpayWebhookEvent,
} from '@/lib/payments/razorpay';

export async function POST(request: Request) {
  // Raw text, before any parsing. This ordering is load-bearing.
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!signature) {
    return Response.json({ error: 'Missing signature.' }, { status: 400 });
  }

  let valid: boolean;
  try {
    valid = verifyWebhookSignature(rawBody, signature);
  } catch {
    // Not configured. 500 so Razorpay retries once the secret is in place,
    // rather than dropping a real payment on the floor.
    return Response.json({ error: 'Webhook not configured.' }, { status: 500 });
  }

  if (!valid) {
    return Response.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookEvent;
  } catch {
    return Response.json({ error: 'Malformed payload.' }, { status: 400 });
  }

  const payment = event.payload?.payment?.entity;

  // Acknowledge anything we do not act on. Razorpay lets you subscribe to more
  // events than this route handles, and retrying them forever helps nobody.
  if (!payment?.order_id) {
    return Response.json({ received: true, ignored: event.event }, { status: 200 });
  }

  const admin = createAdminClient();

  try {
    if (event.event === 'payment.captured') {
      const { error } = await admin.rpc('credit_purchase', {
        p_order_id: payment.order_id,
        p_payment_id: payment.id,
        p_signature: null,
      });

      if (error) {
        // 500 so Razorpay retries — the money is real and the credits are owed.
        console.error('[razorpay] credit_purchase failed', payment.order_id, error.message);
        return Response.json({ error: 'Could not grant credits.' }, { status: 500 });
      }

      return Response.json({ received: true, granted: true }, { status: 200 });
    }

    if (event.event === 'payment.failed') {
      await admin
        .from('payments')
        .update({
          status: 'failed',
          razorpay_payment_id: payment.id,
          failure_reason: payment.error_description ?? 'payment_failed',
        })
        .eq('razorpay_order_id', payment.order_id)
        // Never overwrite a captured payment: events can arrive out of order,
        // and a late `failed` for an already-captured order must not undo it.
        .is('credited_at', null);

      return Response.json({ received: true }, { status: 200 });
    }

    if (event.event === 'payment.authorized') {
      await admin
        .from('payments')
        .update({ status: 'authorized', razorpay_payment_id: payment.id })
        .eq('razorpay_order_id', payment.order_id)
        .is('credited_at', null);

      return Response.json({ received: true }, { status: 200 });
    }

    return Response.json({ received: true, ignored: event.event }, { status: 200 });
  } catch (err) {
    console.error('[razorpay] webhook error', err);
    return Response.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}
