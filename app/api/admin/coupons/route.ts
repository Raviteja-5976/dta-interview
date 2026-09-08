/**
 * /api/admin/coupons — create, list and deactivate promo codes.
 *
 * Codes are never edited after creation, only switched off. A code that has been
 * read off a slide by sixty people is a promise; changing what it is worth after
 * the fact breaks it for whoever redeems next. Deactivating is honest — it stops
 * new redemptions and leaves the ones already made alone.
 *
 * Deleting is not offered either, because `promo_redemptions.code` references
 * this table and the redemption history is the audit trail for every free credit
 * in the system.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin/guard';
import { created, failure, handleRouteError, ok } from '@/lib/api/respond';

/** Mirrors the CHECK constraint in migration 020, so the error arrives in words. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const MAX_CREDITS = 5000;

export async function GET() {
  try {
    await requireAdmin();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('promo_codes')
      .select('code, credits, max_redemptions, redeemed_count, expires_at, active, note, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[admin/coupons]', error);
      return failure(500, 'Could not read the coupon list.', {
        detail: error.message,
        hint: 'If this says the relation does not exist, run supabase/migrations/020_admin_roles_feedback_promos.sql.',
      });
    }
    return ok({ coupons: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin();

    const body = (await request.json()) as {
      code?: string;
      credits?: number;
      maxRedemptions?: number | null;
      expiresAt?: string | null;
      note?: string;
    };

    // Uppercased here as well as in the database, so the code shown back on the
    // success line is the code that was actually stored.
    const code = (body.code ?? '').trim().toUpperCase();
    const credits = Math.floor(Number(body.credits));

    if (!CODE_PATTERN.test(code)) {
      return failure(
        400,
        'Codes are 3-32 characters, letters, digits and dashes only, starting with a letter or digit.',
      );
    }
    if (!Number.isFinite(credits) || credits <= 0) {
      return failure(400, 'Set how many credits the code is worth.');
    }
    if (credits > MAX_CREDITS) {
      return failure(400, `That is more than ${MAX_CREDITS} credits per redemption.`);
    }

    const maxRedemptions =
      body.maxRedemptions == null || body.maxRedemptions === 0
        ? null
        : Math.floor(Number(body.maxRedemptions));

    if (maxRedemptions !== null && (!Number.isFinite(maxRedemptions) || maxRedemptions <= 0)) {
      return failure(400, 'The redemption limit has to be a positive number, or blank for no limit.');
    }

    let expiresAt: string | null = null;
    if (body.expiresAt) {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return failure(400, 'That expiry date could not be read.');
      }
      if (parsed.getTime() <= Date.now()) {
        return failure(400, 'That expiry is in the past — the code would be dead on arrival.');
      }
      expiresAt = parsed.toISOString();
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('promo_codes')
      .insert({
        code,
        credits,
        max_redemptions: maxRedemptions,
        expires_at: expiresAt,
        note: (body.note ?? '').trim().slice(0, 200) || null,
        created_by: adminUser.id,
      })
      .select()
      .single();

    if (error) {
      // 23505 — the primary key. Says which code, because the whole point is
      // that you already used that name for something.
      if (error.code === '23505') {
        return failure(409, `${code} already exists. Pick another code.`);
      }
      return failure(500, 'Could not create that code.');
    }

    return created({ coupon: data });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Switch a code on or off. The only mutation a live code allows. */
export async function PATCH(request: Request) {
  try {
    await requireAdmin();

    const body = (await request.json()) as { code?: string; active?: boolean };
    const code = (body.code ?? '').trim().toUpperCase();

    if (!code) return failure(400, 'Which code?');
    if (typeof body.active !== 'boolean') return failure(400, 'Nothing to change.');

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('promo_codes')
      .update({ active: body.active })
      .eq('code', code)
      .select()
      .maybeSingle();

    if (error) return failure(500, 'Could not update that code.');
    if (!data) return failure(404, 'That code no longer exists.');

    return ok({ coupon: data });
  } catch (err) {
    return handleRouteError(err);
  }
}
