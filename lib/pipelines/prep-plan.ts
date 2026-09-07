/**
 * The preparation plan — RI ∥ SP, against the days until the interview.
 *
 * One artifact with three parts, because they answer one question between them:
 * what should I send, what should I build, and what should I do between now and
 * the interview.
 *
 * ── Why the two agents run in parallel ───────────────────────────────────────
 * Neither reads the other's output. The resume rewrite works from the resume and
 * the posting; the study plan works from the gap report and the calendar. Both
 * ultimately come from P4, which already ran at project prep. So this is one
 * round trip of wall clock rather than two, and the user waits ~20 seconds
 * instead of ~40 for something they asked for and are watching.
 *
 * ── Why it is regenerated rather than versioned ──────────────────────────────
 * `resumes` versions on every rewrite, because an ATS delta between versions is
 * meaningful. A plan has no such delta: it is derived from inputs that are
 * themselves stored, and yesterday's plan against a date that has moved is not
 * history, it is wrong. So this overwrites, and records which resume and which
 * date it was built from so the page can say when it has gone stale.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { runResumeImprovement } from '../agents/ri-resume';
import { runStudyPlan } from '../agents/sp-studyplan';
import { runTargetResume } from '../agents/tr-target-resume';
import type {
  AtsReport,
  GapReport,
  IdealResume,
  JdProfile,
  StudyPlan,
  TargetResume,
} from '../agents/schemas';
import {
  computePrepWindow,
  resolveBlocks,
  skillsWithoutProjectEvidence,
  type PrepWindow,
  type ScheduledBlock,
} from '../engine/prep-window';

/** What lands in `projects.prep_plan`. */
export interface PrepPlan {
  v: 3;
  generated_at: string;
  /** The resume this was built from, so the page can spot a newer upload. */
  resume_id: string | null;
  /** The date it was built against, so the page can spot a moved interview. */
  interview_date: string;
  window: PrepWindow;
  resume: IdealResume | null;
  /**
   * The resume once the plan is done. Null when the second stage failed, or
   * when there was nothing to project forward.
   *
   * Its `preconditions` are re-checked against verified skills on every page
   * view rather than being frozen here — see `evaluatePreconditions`.
   */
  target: TargetResume | null;
  plan: StudyPlan | null;
  /**
   * The schedule with real dates on it.
   *
   * Stored resolved rather than resolved on read: the plan is written once and
   * read many times, and re-deriving dates on every page load would mean a plan
   * silently reinterpreting itself as days pass.
   */
  schedule: ScheduledBlock[];
  /** Set when one half failed. The other half is still worth showing. */
  partial: string | null;
}

export interface PrepPlanResult {
  status: 'ok' | 'failed';
  plan?: PrepPlan;
  error?: string;
}

export async function runPrepPlan(
  supabase: SupabaseClient,
  projectId: string,
  interviewDate: string,
): Promise<PrepPlanResult> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id, company_name, role_title, seniority, jd_profile, gap_report')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) return { status: 'failed', error: 'Project not found.' };

  const jd = project.jd_profile as JdProfile | null;
  const gap = project.gap_report as GapReport | null;

  if (!jd || !gap) {
    return {
      status: 'failed',
      error: 'This project has not finished preparing yet, so there is nothing to plan against.',
    };
  }

  const { data: resume } = await supabase
    .from('resumes')
    .select('id, parsed, ats')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const resumeText = (resume?.parsed as { raw_text?: string } | null)?.raw_text;
  if (!resumeText) {
    return { status: 'failed', error: 'No resume text is available for this project.' };
  }

  const window = computePrepWindow(interviewDate);
  if (window.pressure === 'past') {
    return {
      status: 'failed',
      error: 'That interview date has already passed. Set a future date to build a plan.',
    };
  }

  // What the interviews have actually established, where any have happened. A
  // plan that ignores this sends someone back over ground they already proved.
  const { data: progress } = await supabase
    .from('skill_progress')
    .select('skill, score, depth')
    .eq('project_id', projectId)
    .limit(30);

  const context = { userId: project.user_id, projectId };
  const unevidenced = skillsWithoutProjectEvidence(gap);

  /*
   * `allSettled`, not `all`.
   *
   * These are two independently useful documents. If the study plan fails, a
   * rewritten resume is still worth the wait; if the rewrite fails, the
   * timetable still tells someone what to do tomorrow. Failing both because one
   * model call timed out would throw away work the user is watching a spinner
   * for.
   */
  const [resumeResult, planResult] = await Promise.allSettled([
    runResumeImprovement(
      { resumeText, jd, ats: (resume?.ats as AtsReport | null) ?? null },
      context,
    ),
    runStudyPlan(
      {
        window,
        gap,
        jd,
        roleTitle: project.role_title,
        companyName: project.company_name,
        seniority: project.seniority ?? jd.seniority ?? 'mid',
        unevidenced,
        verifiedSkills: (progress ?? []) as Array<{ skill: string; score: number | null; depth: string | null }>,
      },
      context,
    ),
  ]);

  const idealResume = resumeResult.status === 'fulfilled' ? resumeResult.value : null;
  const studyPlan = planResult.status === 'fulfilled' ? planResult.value : null;

  if (!idealResume && !studyPlan) {
    return { status: 'failed', error: 'Both halves of the plan failed to generate. Try again in a moment.' };
  }

  if (resumeResult.status === 'rejected') console.error('[prep-plan] RI failed', resumeResult.reason);
  if (planResult.status === 'rejected') console.error('[prep-plan] SP failed', planResult.reason);

  /*
   * ── Stage two · the target resume ────────────────────────────────────────
   *
   * Sequential rather than parallel, and the round trip is worth paying for. It
   * consumes the claims RI could not honestly make and the projects SP
   * scheduled, so its unlock conditions name the projects in the schedule
   * underneath it. Run beside them it could only gesture at the same gaps in
   * different words, and the two documents would visibly not be one plan.
   *
   * Skipped when RI found nothing the resume cannot already claim: a target
   * identical to the sendable resume is a second copy with a warning on it,
   * which is worse than not offering one.
   */
  const needsTarget = (idealResume?.cannot_claim_yet.length ?? 0) > 0 || unevidenced.length > 0;

  const targetResume = needsTarget
    ? await runTargetResume(
        { resumeText, jd, gap, current: idealResume, plan: studyPlan },
        context,
      ).catch((err) => {
        // Non-fatal. The sendable resume and the schedule are the load-bearing
        // half of this feature; the target is the motivating extra.
        console.error('[prep-plan] TR failed', err);
        return null;
      })
    : null;

  const plan: PrepPlan = {
    v: 3,
    generated_at: new Date().toISOString(),
    resume_id: resume?.id ?? null,
    interview_date: interviewDate,
    window,
    resume: idealResume,
    target: targetResume,
    plan: studyPlan,
    // The one place model output becomes calendar dates. Anything the model put
    // outside the window, or on a day it had already used, is dropped here.
    schedule: studyPlan ? resolveBlocks(window, studyPlan.blocks) : [],
    partial: !idealResume
      ? 'The resume rewrite did not generate. The study plan below is complete.'
      : !studyPlan
        ? 'The study plan did not generate. The resume rewrite below is complete.'
        : null,
  };

  const { error } = await supabase
    .from('projects')
    .update({ prep_plan: plan, interview_date: interviewDate })
    .eq('id', projectId);

  if (error) {
    return { status: 'failed', error: 'The plan was generated but could not be saved. Try again.' };
  }

  return { status: 'ok', plan };
}
