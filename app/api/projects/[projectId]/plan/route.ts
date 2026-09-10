/**
 * POST /api/projects/[projectId]/plan — set the interview date, and optionally
 * build the preparation plan against it.
 *
 * One route for both because they are one user action split over two moments:
 * someone sets a date the day they book the interview, and generates a plan
 * when they are ready to work. `generate: false` saves the date alone, which is
 * also what the page does when the date changes and the existing plan becomes
 * stale — recording the new date immediately means a page reload does not
 * quietly revert it.
 *
 * ── Building is a loop, not a request ────────────────────────────────────────
 * RI, SP and then TR are long outputs, and Amplify ends every request at 30
 * seconds. So `generate` starts a durable run (lib/pipelines/pipeline-runs.ts)
 * and advances it by one pass; the page then sends `{ continue: true }` until
 * the answer stops saying `pending`. `continue` is also how a reopened page
 * picks up a build that was left running.
 */

import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runPrepPlan, type PrepPlanResult } from '@/lib/pipelines/prep-plan';
import { advanceRun, loadRun, startRun, type PipelineRun } from '@/lib/pipelines/pipeline-runs';
import { computePrepWindow, isValidIsoDate } from '@/lib/engine/prep-window';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

/** A pass takes seconds. This is only a ceiling for hosts that honour it. */
export const maxDuration = 60;

interface PlanBody {
  /** YYYY-MM-DD, in the candidate's own calendar. */
  interviewDate?: string;
  /** False to save the date without spending a generation on it. */
  generate?: boolean;
  /** Advance the build already running rather than starting a new one. */
  continue?: boolean;
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/projects/[projectId]/plan'>) {
  try {
    const { projectId } = await ctx.params;
    const user = await requireUser();

    const supabase = await createSupabaseServerClient();

    /*
     * Ownership is checked by reading the row through the USER's client, which
     * RLS scopes to their own projects. `runPrepPlan` writes through the same
     * client, so the plan itself never needs to bypass the policies that already
     * say who may read a project. The service role is used for one thing only:
     * the `pipeline_runs` row that tracks the build.
     */
    const { data: project } = await supabase
      .from('projects')
      .select('id, status')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) return notFound();

    const body = ((await request.json().catch(() => ({}))) ?? {}) as PlanBody;
    const admin = createAdminClient();

    if (body.continue) {
      const run = await loadRun(admin, 'prep_plan', projectId);
      if (!run) return ok({ status: 'idle' });
      return await advancePlan(admin, supabase, run, user.id);
    }

    const interviewDate = String(body.interviewDate ?? '').trim();

    // Validated rather than trusted: `2026-02-31` parses to March 3rd in a Date
    // constructor, so a typo would silently plan against a different day than
    // the one the candidate typed.
    if (!isValidIsoDate(interviewDate)) {
      return failure(400, 'Give the interview date as a real calendar date, for example 2026-03-14.');
    }

    const window = computePrepWindow(interviewDate);
    if (window.pressure === 'past') {
      return failure(400, 'That date has already passed. Set the day the interview actually falls on.');
    }
    // A date far enough out to be a typo — someone meant 2026, not 2126.
    if (window.daysUntil > 365) {
      return failure(400, 'That date is more than a year away. Check the year.');
    }

    if (body.generate === false) {
      const { error } = await supabase
        .from('projects')
        .update({ interview_date: interviewDate })
        .eq('id', projectId);

      if (error) return failure(500, 'Could not save that date. Try again.');
      return ok({ interviewDate, window, generated: false });
    }

    if (project.status !== 'ready') {
      return failure(
        409,
        'This project is still preparing. The plan is built from its gap analysis, so it has to finish first.',
      );
    }

    // A rebuild replaces whatever was running, and cancels its calls.
    const run = await startRun(admin, {
      kind: 'prep_plan',
      subjectId: projectId,
      userId: user.id,
      input: { interviewDate },
      previous: await loadRun(admin, 'prep_plan', projectId),
    });

    return await advancePlan(admin, supabase, run, user.id);
  } catch (err) {
    return handleRouteError(err);
  }
}

async function advancePlan(
  admin: SupabaseClient,
  supabase: SupabaseClient,
  run: PipelineRun,
  userId: string,
): Promise<Response> {
  const interviewDate = String(run.input.interviewDate ?? '');

  const snapshot = await advanceRun(admin, run, async () => {
    const result = await runPrepPlan(supabase, run.subject_id, interviewDate);
    return { ok: result.status === 'ok', error: result.error, result };
  });

  if (snapshot.status === 'running') {
    return ok({ status: 'running', pending: true, interviewDate, progress: snapshot.progress });
  }

  const result = snapshot.result as PrepPlanResult | null;

  if (snapshot.status === 'failed') {
    return failure(422, result?.error ?? snapshot.error ?? 'Could not build the plan.');
  }

  if (snapshot.settledNow) {
    console.info(
      `[prep-plan] ${run.subject_id} → ${result?.plan?.window.daysUntil ?? '?'}d ` +
        `(${result?.plan?.window.pressure ?? '?'}), ${result?.plan?.schedule.length ?? 0} scheduled days, ` +
        `user ${userId}`,
    );
  }

  return ok({
    status: 'done',
    interviewDate,
    window: result?.plan?.window ?? computePrepWindow(interviewDate),
    generated: true,
    plan: result?.plan,
  });
}
