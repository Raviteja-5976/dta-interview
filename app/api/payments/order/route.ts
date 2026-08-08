/**
 * POST /api/payments/order — start a credit purchase.
 *
 * Creates a Razorpay order and records our own `payments` row against it, then
 * hands the browser what Checkout needs.
 *
 * The pack is looked up server-side from its id. The client sends only the id —
 * never the price or the credit count — because anything the client sends is
 * something the client can change.
 */

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findPack, toPaise } from '@/lib/credits';
import { createOrder, missingRazorpayConfig } from '@/lib/payments/razorpay';
import { created, failure, handleRouteError } from '@/lib/api/respond';

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const missing = missingRazorpayConfig();
    if (missing.length > 0) {
      // Name the missing variables. This is behind auth and exposes env var
      // NAMES only, never values — and "payments are off" with no indication of
      // why is a genuinely infuriating thing to debug.
      return failure(503, 'Payments are not switched on yet.', {
        configuration: true,
        missing,
        detail: `Set ${missing.join(', ')} in .env.local and restart the server.`,
      });
    }

    const { packId } = (await request.json()) as { packId?: string };
    const pack = packId ? findPack(packId) : undefined;
    if (!pack) return failure(400, 'That credit pack does not exist.');

    const supabase = await createSupabaseServerClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', user.id)
      .maybeSingle();

    const receipt = `dta_${Date.now().toString(36)}_${user.id.slice(0, 8)}`;

    const order = await createOrder({
      amountPaise: toPaise(pack.priceInr),
      receipt,
      notes: { user_id: user.id, pack_id: pack.id, credits: String(pack.credits) },
    });

    // Written with the service role: `payments` is read-only from the browser,
    // deliberately. The credit count is recorded here, at order time, so the
    // webhook never has to trust anything the client says later.
    const admin = createAdminClient();
    const { error } = await admin.from('payments').insert({
      user_id: user.id,
      razorpay_order_id: order.id,
      pack_id: pack.id,
      credits: pack.credits,
      amount_paise: order.amount,
      currency: order.currency,
      status: 'created',
      meta: { receipt, pack_name: pack.name },
    });

    if (error) {
      return failure(500, 'Could not start the payment. You have not been charged.');
    }

    return created({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      pack: { id: pack.id, name: pack.name, credits: pack.credits, priceInr: pack.priceInr },
      prefill: {
        name: profile?.full_name ?? '',
        email: profile?.email ?? user.email ?? '',
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
