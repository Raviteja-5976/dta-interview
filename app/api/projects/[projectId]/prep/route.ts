/**
 * POST /api/projects/[projectId]/prep — advance (or start, or retry) Phase 1.
 *
 * Called by the Overview page in a loop while the project is `preparing`, and
 * by the `Retry preparation` button when prep has failed.
 *
 * ── One pass per request ─────────────────────────────────────────────────────
 * P1–P5 take 30–90s end to end, and Amplify ends every request at 30s. So this
 * route never runs the pipeline to completion. It runs one durable pass
 * (lib/pipelines/pipeline-runs.ts) — a few seconds spent starting and checking
 * background model calls — and answers `pending: true` until the pass that
 * finishes it. The page simply asks again.
 *
 * `pipeline_runs` also replaces the `prep_error: { stage: 'running' }` claim
 * this route used to write: the run row's lease is what stops two tabs from
 * advancing the same run at once.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runProjectPrep, type PrepResult } from '@/lib/pipelines/prep';
import { advanceRun, loadRun, startRun } from '@/lib/pipelines/pipeline-runs';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

/** A pass takes seconds. This is only a ceiling for hosts that honour it. */
export const maxDuration = 60;

export async function POST(_request: NextRequest, ctx: RouteContext<'/api/projects/[projectId]/prep'>) {
  try {
    const { projectId } = await ctx.params;
    const user = await requireUser();

    // Ownership check runs through the user's client so RLS does the work.
    // A row the user does not own simply is not there — 404, not 403 (§15).
    const supabase = await createSupabaseServerClient();
    const { data: project } = await supabase
      .from('projects')
      .select('id, status')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) return notFound();
    if (project.status === 'ready') return ok({ status: 'ready', alreadyPrepared: true });
    if (project.status === 'archived') return failure(409, 'This project is archived.');

    // The pipeline writes artifacts the user cannot write themselves
    // (skill_progress has no insert policy, company_cache is service-role only),
    // so from here on it runs with the service role.
    const admin = createAdminClient();

    let run = await loadRun(admin, 'project_prep', projectId);

    // No run yet, or the last one ended without leaving the project ready: a
    // first visit or a retry. Either way it starts clean.
    if (!run || run.status !== 'running') {
      await admin.from('projects').update({ status: 'preparing', prep_error: null }).eq('id', projectId);
      run = await startRun(admin, {
        kind: 'project_prep',
        subjectId: projectId,
        userId: user.id,
        previous: run,
      });
    }

    const snapshot = await advanceRun(admin, run, async () => {
      const result = await runProjectPrep(admin, projectId);
      return { ok: result.status === 'ready', error: result.error?.message, result };
    });

    if (snapshot.status === 'running') {
      return ok({ status: 'preparing', pending: true, progress: snapshot.progress });
    }

    const result = snapshot.result as PrepResult | null;

    // A pass that threw, rather than returning, never reached the pipeline's
    // own failure write. Without this the project would sit in `preparing` with
    // nothing advancing it.
    if (snapshot.status === 'failed' && snapshot.settledNow && !result) {
      await admin
        .from('projects')
        .update({
          status: 'failed',
          prep_error: {
            stage: 'parsing',
            message: snapshot.error ?? 'Preparation failed.',
            at: new Date().toISOString(),
            recoverable: true,
          },
        })
        .eq('id', projectId)
        .eq('status', 'preparing');
    }

    return ok({
      status: snapshot.status === 'done' ? 'ready' : 'failed',
      stage: result?.stage,
      companyResearchSkipped: result?.companyResearchSkipped,
      error: result?.error ?? (snapshot.error ? { stage: 'parsing', message: snapshot.error } : undefined),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
