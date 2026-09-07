/**
 * SP · Study Plan Agent
 *
 * Turns the gap report and the days remaining into a schedule the candidate can
 * actually follow, plus the portfolio projects worth building first.
 *
 * ── It is handed the calendar; it does not compute one ───────────────────────
 * How many days there are, which dates those are, what weekday each falls on and
 * whether the window is a comfortable run or a two-day scramble are all decided
 * in lib/engine/prep-window.ts before this agent is called. It writes day
 * OFFSETS, and the engine resolves them back to dates, discarding anything
 * outside the window.
 *
 * That is not defensive plumbing, it is the difference between a plan someone
 * trusts and one they don't. A schedule with a date that does not exist, or an
 * eleventh day in a nine-day window, discredits every correct thing next to it.
 *
 * ── It is allowed to say there is not enough time ────────────────────────────
 * `verdict` exists so the plan can be honest about a two-day window against six
 * missing skills. A plan that promises full coverage in that time costs the
 * candidate the two days they had.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { studyPlanSchema, type GapReport, type JdProfile, type StudyPlan } from './schemas';
import { describeCalendar, type PrepWindow, type UnevidencedSkill } from '../engine/prep-window';

const SYSTEM = `You write a preparation plan for someone with a specific interview on a specific day.

You are given the calendar as numbered days. You write DAY OFFSETS — day 0, day 1 — and never dates, never weekday names in the plan itself. Something else turns your offsets into real dates. If you write a date it will be discarded; if you write an offset outside the range you were given, that day is dropped and the candidate loses it.

One block per day at most. Do not plan the same day twice.

## Scope the plan to the time that exists

You are told how much time there is. These are different plans, not the same plan at different lengths:

- crash (two days or fewer): triage. Two or three things, chosen because they are the most likely to come up and the most fixable in hours. Say in \`verdict\` what you are deliberately not covering. Do not schedule building a project — it will not be finished, and an unfinished project is worth nothing in an interview.
- tight (a week or so): the highest-priority gaps only, to working depth. One small project at most, and only if it genuinely fits.
- comfortable (more than a week): real coverage. Projects, spaced practice, and review built in.

If the honest answer is that the gaps cannot be closed in the time available, say so in \`verdict\` in the first sentence, then give the plan that makes the best use of the days there are. Never pad a plan to fill a window, and never compress one to pretend a window is enough.

## The days themselves

- \`focus\` is the ONE thing that day is for. A day with four unrelated focuses is a day where nothing lands.
- \`tasks\` are concrete and checkable. "Write a query that finds the second-highest salary per department, then explain why your approach beats a self-join" is a task. "Study SQL" is not.
- \`est_hours\` must be liveable. Most people preparing for an interview have a job. Two to three hours on a weekday, more at a weekend, and you are told which days are weekends. A plan that assumes eight-hour weekdays is abandoned on day two, and an abandoned plan is worse than a modest one.
- Build in \`review\`. Something studied on day 2 and never revisited is gone by day 12. Spaced revisits are what make the earlier days worth anything.
- \`practice\` days are mock interviews and speaking answers out loud. Reading about a topic and being able to explain it under pressure are different skills, and only one of them is being tested.
- \`rest\` is a legitimate kind. Use it rather than silently leaving a gap, so the candidate knows the day is meant to be empty.

## Projects

You are told which of the role's skills the resume does not evidence through actual work. Those are what a project would fix.

Recommend at most three, and fewer is usually right. For each, \`scope\` must be small enough to FINISH in the hours you estimate — a finished small thing beats an abandoned ambitious one, and an interviewer can tell the difference immediately. Schedule the build days in \`blocks\` so the project has real time rather than being a hopeful footnote.

Recommend nothing if the resume already demonstrates the role's skills through real work. An empty list is a correct answer, and a made-up weekend project would compete for time with things that matter more.

\`resume_bullet\` is what they could honestly write once the thing is built and working — not once it is started.

## The day before

\`day_before\` is consolidation and logistics. Nothing new goes in it. Reviewing their own resume, re-reading the job posting, checking the kit, sleeping.`;

export interface StudyPlanInput {
  window: PrepWindow;
  gap: GapReport;
  jd: JdProfile;
  roleTitle: string;
  companyName: string;
  seniority: string;
  /** From `skillsWithoutProjectEvidence` — what a portfolio project would fix. */
  unevidenced: UnevidencedSkill[];
  /** What the interviews have already established, when there have been any. */
  verifiedSkills?: Array<{ skill: string; score: number | null; depth: string | null }>;
}

const PRESSURE_BRIEF: Record<string, string> = {
  crash:
    'This is a CRASH window. Triage only — two or three things, chosen for likelihood and fixability. No project builds.',
  tight:
    'This is a TIGHT window. Highest-priority gaps only, to working depth. At most one small project, and only if it truly fits.',
  comfortable:
    'This is a COMFORTABLE window. Plan real coverage: projects, spaced practice, and review days that revisit earlier material.',
  past: 'The interview date has already passed.',
};

export async function runStudyPlan(
  input: StudyPlanInput,
  context?: RunContext,
): Promise<StudyPlan> {
  const { window } = input;

  // Weakest and most important first — the order the plan should attack them in.
  const gaps = [...input.gap.skills]
    .filter((s) => s.status !== 'SURPLUS' && s.jd_importance >= 0.35)
    .sort((a, b) => b.investigation_priority - a.investigation_priority || b.jd_importance - a.jd_importance)
    .slice(0, 12)
    .map((s) => `- ${s.skill} · ${s.status} · role importance ${s.jd_importance.toFixed(2)} · resume: ${s.resume_evidence} · ${s.rationale}`)
    .join('\n');

  const result = await runAgent({
    agent: 'SP',
    schema: studyPlanSchema,
    system: SYSTEM,
    prompt: [
      `Interviewing for: ${input.roleTitle} at ${input.companyName} (${input.seniority})`,
      '',
      `TIME AVAILABLE: ${window.daysUntil} day${window.daysUntil === 1 ? '' : 's'} until the interview.`,
      `You are planning ${window.planDays} of them, addressed as day 0 to day ${Math.max(0, window.planDays - 1)}.`,
      // Only present when the interview is far enough out that a dated plan
      // would be fiction. Saying so beats silently planning the wrong six weeks.
      window.leadDays > 0
        ? `There are a further ${window.leadDays} days BEFORE this plan starts. Do not schedule them — say in \`verdict\` what the candidate should be doing with that lead time in general terms.`
        : '',
      PRESSURE_BRIEF[window.pressure] ?? '',
      '',
      `<calendar>\n${describeCalendar(window)}\n</calendar>`,
      '',
      `<gaps>\n${gaps || 'No significant gaps were identified.'}\n</gaps>`,
      '',
      input.unevidenced.length
        ? `<skills_with_no_project_behind_them>\n${input.unevidenced
            .map((s) => `- ${s.skill} (role importance ${s.importance.toFixed(2)}, resume shows: ${s.evidence})`)
            .join('\n')}\nThese are what a portfolio project would fix.\n</skills_with_no_project_behind_them>`
        : '<skills_with_no_project_behind_them>\nNone — the resume evidences this role\'s skills through real work. Do not invent a project to fill this section.\n</skills_with_no_project_behind_them>',
      '',
      input.verifiedSkills?.length
        ? `<already_tested_in_mock_interviews>\n${input.verifiedSkills
            .map((v) => `- ${v.skill}: scored ${v.score ?? 'n/a'}/10 at ${v.depth ?? 'unknown'} depth`)
            .join('\n')}\nWeight the plan towards what went badly. Do not spend days on what is already strong.\n</already_tested_in_mock_interviews>`
        : '',
      '',
      'Write the plan. Day offsets only — never dates.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    meta: {
      days_until: window.daysUntil,
      plan_days: window.planDays,
      pressure: window.pressure,
      unevidenced: input.unevidenced.length,
    },
  });

  return result.data;
}
