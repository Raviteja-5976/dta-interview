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
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { runPrepPlan } from '@/lib/pipelines/prep-plan';
import { computePrepWindow, isValidIsoDate } from '@/lib/engine/prep-window';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

/** Two model calls in parallel, both on medium reasoning over a long output. */
export const maxDuration = 180;

interface PlanBody {
  /** YYYY-MM-DD, in the candidate's own calendar. */
  interviewDate: string;
  /** False to save the date without spending a generation on it. */
  generate?: boolean;
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/projects/[projectId]/plan'>) {
  try {
    const { projectId } = await ctx.params;
    const user = await requireUser();

    const supabase = await createSupabaseServerClient();

    /*
     * Ownership is checked by reading the row through the USER's client, which
     * RLS scopes to their own projects. `runPrepPlan` writes through the same
     * client, so there is no service-role escalation anywhere in this path —
     * nothing here needs to bypass the policies that already say who may read a
     * project.
     */
    const { data: project } = await supabase
      .from('projects')
      .select('id, status')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) return notFound();

    const body = (await request.json()) as PlanBody;
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

    const result = await runPrepPlan(supabase, projectId, interviewDate);
    if (result.status === 'failed') {
      return failure(422, result.error ?? 'Could not build the plan.');
    }

    console.info(
      `[prep-plan] ${projectId} → ${window.daysUntil}d (${window.pressure}), ` +
        `${result.plan?.schedule.length ?? 0} scheduled days, user ${user.id}`,
    );

    return ok({ interviewDate, window, generated: true, plan: result.plan });
  } catch (err) {
    return handleRouteError(err);
  }
}
