/**
 * GET /api/admin/users — the console's user table, plus the header totals.
 *
 * Reads `admin_user_overview` and `admin_totals` (migration 020), which is why
 * this is one round trip instead of five aggregates per row. Both views are
 * granted to the service role only, so this handler is the only way in — and it
 * checks `requireAdmin()` before it opens the service-role client, never after.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin/guard';
import { failure, handleRouteError, ok } from '@/lib/api/respond';

/** Columns the table can sort by. Anything else is rejected rather than passed through. */
const SORTABLE = new Set([
  'created_at',
  'credits_balance',
  'interviews_completed',
  'coding_questions',
  'skill_questions',
  'paid_paise',
  'last_interview_at',
]);

export async function GET(request: Request) {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const sortParam = url.searchParams.get('sort') ?? 'created_at';
    const sort = SORTABLE.has(sortParam) ? sortParam : 'created_at';
    const ascending = url.searchParams.get('dir') === 'asc';

    // PostgREST's `.or()` takes a comma-separated filter string, so a comma or a
    // parenthesis in the search term would be parsed as filter syntax rather
    // than as text. Strip them instead of escaping — nobody searches for them.
    const q = (url.searchParams.get('q') ?? '').trim().replace(/[,()*\\]/g, '');

    const admin = createAdminClient();

    let query = admin
      .from('admin_user_overview')
      .select('*', { count: 'exact' })
      .order(sort, { ascending, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (q) {
      query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
    }

    const [{ data: users, count, error }, { data: totals }] = await Promise.all([
      query,
      admin.from('admin_totals').select('*').maybeSingle(),
    ]);

    if (error) {
      // Almost always one thing: migration 020 has not been run, so
      // admin_user_overview does not exist yet. Say so rather than returning a
      // bare 500 that sends you reading server logs.
      console.error('[admin/users]', error);
      return failure(500, 'Could not read the user list.', {
        detail: error.message,
        hint: 'If this says the relation does not exist, run supabase/migrations/020_admin_roles_feedback_promos.sql.',
      });
    }

    return ok({
      users: users ?? [],
      total: count ?? 0,
      totals: totals ?? null,
      limit,
      offset,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
