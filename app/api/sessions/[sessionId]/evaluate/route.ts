/**
 * POST /api/sessions/[sessionId]/evaluate — advance Phase 3.
 *
 * Called by the Processing screen in a loop. Evaluation takes 1-3 minutes —
 * around fifteen grading calls, the rewrites, the report — and Amplify ends
 * every request at 30 seconds, so each request is one durable pass
 * (lib/pipelines/pipeline-runs.ts) that answers `pending: true` until the pass
 * that finishes the report.
 *
 * On failure the credit is refunded automatically. sitemap-workflow.md §10: a
 * failed evaluation must never silently consume a credit.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runEvaluation, type EvaluationResult } from '@/lib/pipelines/evaluate';
import { advanceRun, loadRun, startRun } from '@/lib/pipelines/pipeline-runs';
import { handleRouteError, notFound, ok } from '@/lib/api/respond';

/** A pass takes seconds. This is only a ceiling for hosts that honour it. */
export const maxDuration = 60;

export async function POST(_request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/evaluate'>) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, status, credits_charged, error')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    if (session.status === 'complete') {
      return ok({ status: 'complete', alreadyEvaluated: true });
    }

    const admin = createAdminClient();
    let run = await loadRun(admin, 'evaluation', sessionId);

    // Already settled as failed — the refund went out on the pass that did it.
    if (session.status === 'failed' && run?.status !== 'running') {
      const message = (session.error as { message?: string } | null)?.message;
      return ok({
        status: 'failed',
        error: run?.error ?? message ?? 'Something went wrong while writing your report.',
        refunded: session.credits_charged,
      });
    }

    if (!run || run.status !== 'running') {
      run = await startRun(admin, {
        kind: 'evaluation',
        subjectId: sessionId,
        userId: session.user_id,
        previous: run,
      });
    }

    const snapshot = await advanceRun(admin, run, async () => {
      const result = await runEvaluation(admin, sessionId);
      return { ok: result.status === 'complete', error: result.error, result };
    });

    if (snapshot.status === 'running') {
      return ok({ status: 'processing', pending: true, progress: snapshot.progress });
    }

    const result = snapshot.result as EvaluationResult | null;

    if (snapshot.status === 'failed') {
      // Only on the pass that settled it, so the ledger sees one refund request.
      if (snapshot.settledNow) {
        // A pass that threw, rather than returning, never reached the
        // pipeline's own failure write.
        await admin
          .from('sessions')
          .update({
            status: 'failed',
            error: {
              stage: 'evaluation',
              message: snapshot.error ?? 'Evaluation failed.',
              at: new Date().toISOString(),
            },
          })
          .eq('id', sessionId)
          .eq('status', 'processing');

        if (session.credits_charged > 0) {
          // refund_credits is idempotent per session, so a retried evaluation
          // cannot refund twice.
          await admin.rpc('refund_credits', {
            p_user_id: session.user_id,
            p_amount: session.credits_charged,
            p_session: sessionId,
            p_reason: 'evaluation_failed',
          });
        }
      }

      return ok({
        status: 'failed',
        error: result?.error ?? snapshot.error,
        refunded: session.credits_charged,
      });
    }

    return ok({ status: 'complete', overall: result?.overall, refunded: 0 });
  } catch (err) {
    return handleRouteError(err);
  }
}
