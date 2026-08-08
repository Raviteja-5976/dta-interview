/**
 * POST /api/projects/[projectId]/prep — run (or retry) Phase 1 preparation.
 *
 * Called by the Overview page when it finds a project in `preparing`, and by the
 * `Retry preparation` button when prep has failed.
 *
 * ── On the missing job queue ─────────────────────────────────────────────────
 * db-design.md and sitemap-workflow.md both assume an "enqueue prep job" step
 * against Temporal/Inngest/BullMQ. This route is the inline stand-in: it runs
 * the pipeline synchronously inside a long-lived request. That is fine at low
 * volume and has one real weakness — a client that retries mid-run can start a
 * second pass. The claim below narrows that window; a real queue closes it.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runProjectPrep } from '@/lib/pipelines/prep';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

/** P1-P5 takes 30-90s; the default 15s ceiling would cut it off mid-pipeline. */
export const maxDuration = 300;

const STALE_CLAIM_MS = 4 * 60 * 1000;

export async function POST(_request: NextRequest, ctx: RouteContext<'/api/projects/[projectId]/prep'>) {
  try {
    const { projectId } = await ctx.params;
    await requireUser();

    // Ownership check runs through the user's client so RLS does the work.
    // A row the user does not own simply is not there — 404, not 403 (§15).
    const supabase = await createSupabaseServerClient();
    const { data: project } = await supabase
      .from('projects')
      .select('id, status, prep_error, updated_at')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) return notFound();
    if (project.status === 'ready') return ok({ status: 'ready', alreadyPrepared: true });
    if (project.status === 'archived') return failure(409, 'This project is archived.');

    const claim = project.prep_error as { stage?: string; started_at?: string } | null;
    const running =
      claim?.stage === 'running' &&
      claim.started_at &&
      Date.now() - new Date(claim.started_at).getTime() < STALE_CLAIM_MS;

    if (running) return ok({ status: 'preparing', alreadyRunning: true });

    // The pipeline writes artifacts the user cannot write themselves
    // (skill_progress has no insert policy, company_cache is service-role only),
    // so from here on it runs with the service role.
    const admin = createAdminClient();

    await admin
      .from('projects')
      .update({
        status: 'preparing',
        prep_error: { stage: 'running', started_at: new Date().toISOString() },
      })
      .eq('id', projectId);

    const result = await runProjectPrep(admin, projectId);

    return ok({
      status: result.status,
      stage: result.stage,
      companyResearchSkipped: result.companyResearchSkipped,
      error: result.error,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
