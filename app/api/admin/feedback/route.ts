/**
 * GET /api/admin/feedback — post-interview feedback, newest first.
 *
 * Joined out to the person and the interview they are talking about, because a
 * rating of 2 with no idea which session produced it is not actionable. The
 * session id comes back so the console can link straight to that report.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin/guard';
import { failure, handleRouteError, ok } from '@/lib/api/respond';

export async function GET(request: Request) {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const rating = Number(url.searchParams.get('rating'));

    const admin = createAdminClient();

    let query = admin
      .from('session_feedback')
      // Unqualified embeds: session_feedback has exactly one FK to each of these,
      // so PostgREST resolves them without a hint.
      .select(
        `id, session_id, user_id, rating, would_recommend, improvement, created_at,
         profiles ( email, full_name ),
         sessions ( seq, duration_sec, overall_score, project_id )`,
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // The low-rating filter is the one that gets used. Everything else is noise.
    if (rating >= 1 && rating <= 5) {
      query = query.eq('rating', rating);
    }

    const { data, count, error } = await query;
    if (error) {
      console.error('[admin/feedback]', error);
      return failure(500, 'Could not read feedback.', {
        detail: error.message,
        hint: 'If this says the relation does not exist, run supabase/migrations/020_admin_roles_feedback_promos.sql.',
      });
    }

    return ok({ feedback: data ?? [], total: count ?? 0, limit, offset });
  } catch (err) {
    return handleRouteError(err);
  }
}
