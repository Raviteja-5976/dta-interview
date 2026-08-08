/**
 * POST /api/sessions/[sessionId]/evaluate — Phase 3.
 *
 * Fired by the Processing screen. Takes 1-3 minutes, which is exactly why that
 * screen is a route rather than a modal: people close the tab, and this has to
 * survive it.
 *
 * On failure the credit is refunded automatically. sitemap-workflow.md §10: a
 * failed evaluation must never silently consume a credit.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runEvaluation } from '@/lib/pipelines/evaluate';
import { handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 300;

export async function POST(_request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/evaluate'>) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, status, credits_charged')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    if (session.status === 'complete') {
      return ok({ status: 'complete', alreadyEvaluated: true });
    }

    const admin = createAdminClient();
    const result = await runEvaluation(admin, sessionId);

    if (result.status === 'failed' && session.credits_charged > 0) {
      // refund_credits is idempotent per session, so a retried evaluation
      // cannot refund twice.
      await admin.rpc('refund_credits', {
        p_user_id: session.user_id,
        p_amount: session.credits_charged,
        p_session: sessionId,
        p_reason: 'evaluation_failed',
      });
    }

    return ok({
      status: result.status,
      overall: result.overall,
      error: result.error,
      refunded: result.status === 'failed' ? session.credits_charged : 0,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
