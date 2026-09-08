/**
 * POST /api/admin/credits — grant credits to one user by hand.
 *
 * The backstop, not the main road. For a workshop, a promo code is the right
 * tool (see /api/admin/coupons): sixty students sign up inside ten minutes, and
 * you cannot grant to an account that does not exist yet. This is for the one
 * whose code failed, the one who turned up late, and the goodwill refund.
 *
 * The grant itself is `grant_credits()` from migration 020 — the same RPC promo
 * redemption uses, so there is exactly one code path in the system that can
 * create credits from nothing, and it writes the balance and the ledger row in
 * one transaction.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin/guard';
import { failure, handleRouteError, ok } from '@/lib/api/respond';

/** A typo of 5000 for 500 is a real amount of money. Nothing legitimate is bigger. */
const MAX_GRANT = 5000;

export async function POST(request: Request) {
  try {
    const admin_user = await requireAdmin();

    const body = (await request.json()) as {
      userId?: string;
      amount?: number;
      reason?: string;
    };

    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const amount = Math.floor(Number(body.amount));
    const reason = (body.reason ?? '').trim().slice(0, 200);

    if (!userId) return failure(400, 'Pick a user first.');
    if (!Number.isFinite(amount) || amount <= 0) {
      return failure(400, 'Enter how many credits to grant.');
    }
    if (amount > MAX_GRANT) {
      return failure(400, `That is more than ${MAX_GRANT} credits. Grant it in smaller amounts if you really mean it.`);
    }

    const admin = createAdminClient();

    const { data, error } = await admin.rpc('grant_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_reason: 'admin_grant',
      // Who did it and why, on the ledger row itself. A free credit with no
      // explanation is one you cannot account for three months later.
      p_meta: {
        granted_by: admin_user.id,
        granted_by_email: admin_user.email,
        note: reason || null,
      },
    });

    if (error) {
      if (error.message.includes('user_not_found')) {
        return failure(404, 'That user no longer exists.');
      }
      return failure(500, 'The grant did not go through. No credits were added.');
    }

    return ok({ balance: data as number, granted: amount });
  } catch (err) {
    return handleRouteError(err);
  }
}
