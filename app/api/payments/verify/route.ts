/**
 * POST /api/payments/verify — the Checkout callback.
 *
 * This exists for speed of feedback, not for correctness. The webhook is the
 * source of truth: it fires even if the user closes the tab the instant the
 * payment succeeds, which is exactly when a browser-only flow loses a payment.
 *
 * Both paths call the same idempotent `credit_purchase`, so whichever arrives
 * first grants the credits and the other is a no-op.
 */

import { requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyCheckoutSignature } from '@/lib/payments/razorpay';
import { failure, handleRouteError, ok } from '@/lib/api/respond';

interface VerifyBody {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as VerifyBody;

    const orderId = body.razorpay_order_id;
    const paymentId = body.razorpay_payment_id;
    const signature = body.razorpay_signature;

    if (!orderId || !paymentId || !signature) {
      return failure(400, 'That payment response was incomplete.');
    }

    if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
      // A bad signature means the payload did not come from Razorpay. Record it
      // and grant nothing.
      const admin = createAdminClient();
      await admin
        .from('payments')
        .update({ status: 'failed', failure_reason: 'signature_mismatch' })
        .eq('razorpay_order_id', orderId);

      return failure(400, 'We could not verify that payment. Nothing has been charged to your account.');
    }

    const admin = createAdminClient();

    // The order must belong to the caller. Without this check a valid signature
    // from someone else's payment would credit the wrong account.
    const { data: payment } = await admin
      .from('payments')
      .select('user_id, credits')
      .eq('razorpay_order_id', orderId)
      .maybeSingle();

    if (!payment || payment.user_id !== user.id) {
      return failure(404, 'We could not find that payment.');
    }

    const { data: balance, error } = await admin.rpc('credit_purchase', {
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_signature: signature,
    });

    if (error) {
      // The payment is real and the webhook will still land, so this is a
      // delay, not a loss. Say so.
      return failure(502, 'Your payment went through — the credits are on their way.', {
        detail: error.message,
      });
    }

    return ok({ credited: payment.credits, balance });
  } catch (err) {
    return handleRouteError(err);
  }
}
