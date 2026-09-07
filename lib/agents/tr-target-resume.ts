/**
 * TR · Target Resume Agent
 *
 * The resume the candidate is working towards — what the document looks like
 * once the study plan is done and the gaps have closed.
 *
 * ── The relationship to RI ───────────────────────────────────────────────────
 * RI writes what can be sent today and may invent nothing. This one is allowed
 * to write claims that are not true yet, because showing the destination is the
 * whole point of it.
 *
 * They are separate agents for that reason and no other. One prompt holding both
 * "invent nothing" and "project forward" produces contamination in the direction
 * that costs the user something real: the sendable resume quietly acquiring a
 * line they have not earned and will be asked about in a room.
 *
 * ── The constraint that keeps this useful rather than a fantasy ──────────────
 * It projects SKILLS forward, never a career. Same employers, same job titles,
 * same dates. What changes is what this person can credibly say about their
 * skills once the projects in their plan are built and the gaps are closed. A
 * target resume with a job they do not have is not a target, it is a daydream —
 * and it is unusable, because the thing it is measured against is a real
 * application to a real posting.
 *
 * ── It runs after RI and SP, not beside them ────────────────────────────────
 * It is given `cannot_claim_yet` from RI (precisely the claims that need
 * projecting) and the projects from SP (precisely what earns them). That costs a
 * second round trip of wall clock and buys a target whose unlock conditions name
 * the projects in the schedule underneath it, rather than two documents that
 * gesture at the same gaps in different words.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import {
  targetResumeSchema,
  type GapReport,
  type IdealResume,
  type JdProfile,
  type StudyPlan,
  type TargetResume,
} from './schemas';

const SYSTEM = `You write the resume a candidate is AIMING AT — what their resume will say once they have done the preparation in front of them and closed the gaps against one specific job posting.

This document is not for sending. It is a target, and the person reading it knows that. Your job is to make the destination concrete enough to work towards.

## Same person, later

Project SKILLS forward. Never a career.

- Same employers. Same job titles. Same dates. Same education.
- You may add a PROJECT they are planning to build, because building it is in their plan and it is a thing they will genuinely have done.
- You may strengthen what an existing bullet claims where the plan closes the gap that held it back.
- You may NOT invent a promotion, a new employer, a team they never led, a scale they will not have touched, or years of experience they will not have accrued.

A target resume containing a job this person does not have is unusable. They are applying to a real posting with a real history, and the document has to still be theirs.

## Every line is marked, and the marking is the point

\`status\` is either:
- \`now\` — the current resume already supports this line. Carry it forward, tightened for the posting.
- \`earned\` — this line is NOT true yet. It becomes true when something specific happens.

For every \`earned\` line, \`unlocked_by\` says exactly what makes it true. Where the study plan contains a project that would do it, NAME THAT PROJECT — the candidate is looking at both documents and they should obviously be the same plan. Otherwise describe the smallest piece of real work that would earn it.

Be honest about which is which. An \`earned\` line marked \`now\` is the one failure mode that matters here: it puts an unearned claim into a document with no warning on it.

\`depends_on\` lists the gap skills the line rests on, spelled exactly as they were given to you.

## preconditions

The gate on the whole document. What has to become true before this resume is honest to send.

Spell each \`skill\` EXACTLY as it appears in the gaps you were given — these are matched automatically against what the candidate's mock interviews have actually verified, and a renamed skill silently reads as never tested.

\`proof\` is what an interviewer would accept as demonstrating it. Not "understand Kafka" — something like "can explain what happened when a consumer fell behind, and what you changed".

## gap_summary

One paragraph, addressed to the candidate, on the distance between the resume they have and this one. Concrete about how much of it is close and how much is real work. If most of this document is already true, say so — that is good news and they should hear it. If most of it is not, say that too, plainly and without discouraging them.

## Tone

Identical to a real resume. Plain, outcome-first, no "spearheaded", no "passionate about". The lines have to be usable verbatim the day they become true.`;

export interface TargetResumeInput {
  resumeText: string;
  jd: JdProfile;
  gap: GapReport;
  /** RI's output — `cannot_claim_yet` is exactly what needs projecting forward. */
  current: IdealResume | null;
  /** SP's output — the projects that earn the claims. */
  plan: StudyPlan | null;
}

export async function runTargetResume(
  input: TargetResumeInput,
  context?: RunContext,
): Promise<TargetResume> {
  const gaps = [...input.gap.skills]
    .filter((s) => s.status !== 'SURPLUS' && s.jd_importance >= 0.35)
    .sort((a, b) => b.jd_importance - a.jd_importance)
    .slice(0, 12)
    .map((s) => `- ${s.skill} · ${s.status} · role importance ${s.jd_importance.toFixed(2)} · resume shows: ${s.resume_evidence}`)
    .join('\n');

  const result = await runAgent({
    agent: 'TR',
    schema: targetResumeSchema,
    system: SYSTEM,
    prompt: [
      `<current_resume>\n${input.resumeText.slice(0, 20_000)}\n</current_resume>`,
      '',
      '<target_role>',
      `${input.jd.role_title} (${input.jd.seniority})`,
      `Required: ${input.jd.required_skills.map((s) => s.skill).join(', ')}`,
      '</target_role>',
      '',
      `<gaps>\n${gaps || 'No significant gaps.'}\n</gaps>`,
      '',
      // The claims RI could not honestly make. These are the lines that need to
      // exist here as `earned`, and their absence would make this document a
      // reworded copy of the sendable one.
      input.current?.cannot_claim_yet.length
        ? `<cannot_claim_today>\n${input.current.cannot_claim_yet
            .map((c) => `- ${c.skill}: ${c.what_would_earn_it}`)
            .join('\n')}\nThese are the claims to project forward as \`earned\` lines.\n</cannot_claim_today>`
        : '',
      '',
      input.plan?.projects_to_build.length
        ? `<projects_in_their_plan>\n${input.plan.projects_to_build
            .map(
              (p) =>
                `- "${p.name}" (${p.est_hours}h): ${p.pitch} — would evidence ${p.builds_evidence_for.join(', ')}. Planned resume line: "${p.resume_bullet}"`,
            )
            .join('\n')}\nName these projects in \`unlocked_by\` where they are what earns a line.\n</projects_in_their_plan>`
        : '',
      '',
      'Write the target resume. Mark every line `now` or `earned`, and be strict about which.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    meta: {
      role: input.jd.role_title,
      cannot_claim: input.current?.cannot_claim_yet.length ?? 0,
      planned_projects: input.plan?.projects_to_build.length ?? 0,
    },
  });

  return result.data;
}
