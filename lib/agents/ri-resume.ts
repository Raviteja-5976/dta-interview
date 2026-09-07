/**
 * RI · Ideal Resume Agent
 *
 * Rewrites the candidate's resume for one specific posting, and says plainly
 * what it could not make it claim.
 *
 * ── The rule this agent exists inside ────────────────────────────────────────
 * It may not invent experience. Not a job, not a skill, not an outcome. Every
 * rewritten line quotes the line it came from, which is what turns that rule
 * from an instruction into something the UI can show and the candidate can
 * check — an unsourced line is visible as unsourced.
 *
 * This matters more here than anywhere else in the system. Everything else this
 * product makes is practice; a resume is a document someone sends to an
 * employer with their name on it. A model that quietly upgrades "familiar with
 * Kubernetes" into "operated production Kubernetes clusters" has not improved
 * their resume, it has written a claim they will be asked about in a room and
 * cannot support.
 *
 * `cannot_claim_yet` is the counterweight, and it is the field the rest of the
 * feature is built on: what the resume genuinely cannot say yet is exactly what
 * the study plan and the project recommendations are for.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { idealResumeSchema, type AtsReport, type IdealResume, type JdProfile } from './schemas';

const SYSTEM = `You rewrite a resume so it lands against one specific job posting. You return the whole document, rewritten — not a list of notes about it.

## The hard rule

You may not invent experience. Not a job, not a skill, not a tool, not a number, not an outcome.

Every line you write in \`lines\` must be a rewrite of something the candidate actually wrote, and you must put that source text in \`original\`, verbatim. If you cannot point at the words you rewrote, you may not write the line.

The only exception is structure — a section heading, or a skills line assembled from skills they already listed. Those may have an empty \`original\`. A new FACT may never have one.

This rule is not pedantry about honesty in the abstract. Everything you write here will be read back to this person in an interview and they will be asked to expand on it. A claim they cannot support is worse for them than the weaker line it replaced.

Where you are unsure whether the resume supports a claim, write the weaker version.

## What actually moves the needle, in order

1. Lead with the outcome, not the activity. "Cut p99 latency 40% by replacing N+1 queries with a single join" beats "Responsible for optimising database queries". The facts are the same; one of them says what happened.
2. Use the posting's own words for things they already do. If they wrote "containerised the service" and the posting says Docker, say Docker. Same fact, matched vocabulary, and this is most of what an ATS is actually measuring.
3. Quantify what is already quantifiable. If a number appears elsewhere in the resume and belongs on this line, move it here. Do not estimate one that does not exist.
4. Cut what does not serve this application. Put those in \`removed\` with the reason. A resume is a claim about relevance, and everything irrelevant on it weakens the claim.
5. Order for this role. The most relevant experience goes first, whatever the chronology says, as long as dates stay truthful.

## cannot_claim_yet

The posting will want things this resume cannot be made to say. List them.

For each, \`what_would_earn_it\` is the SMALLEST real thing that would make the claim true — a specific project, a specific piece of work, something finishable. Not "gain experience with Kafka". Something like "build and run a consumer that survives a broker restart, and be able to say what happened when it did".

Be strict about what lands here rather than in a rewritten line. If the resume shows a tutorial-level brush with something and the role needs production depth, the honest place for it is here, not in a bullet with confident wording.

## Tone

Plain. No "spearheaded", no "leveraged", no "passionate about". Short lines — a resume line that runs past two printed lines does not get read. Write like the person did the work and is describing it to a colleague.`;

export interface ResumeImprovementInput {
  resumeText: string;
  jd: JdProfile;
  /** Null when P2's ATS pass failed. The rewrite is still worth doing without it. */
  ats: AtsReport | null;
}

export async function runResumeImprovement(
  input: ResumeImprovementInput,
  context?: RunContext,
): Promise<IdealResume> {
  const result = await runAgent({
    agent: 'RI',
    schema: idealResumeSchema,
    system: SYSTEM,
    prompt: [
      `<resume>\n${input.resumeText.slice(0, 20_000)}\n</resume>`,
      '',
      '<target_role>',
      `${input.jd.role_title} (${input.jd.seniority})`,
      `Required: ${input.jd.required_skills.map((s) => s.skill).join(', ')}`,
      input.jd.preferred_skills.length
        ? `Preferred: ${input.jd.preferred_skills.map((s) => s.skill).join(', ')}`
        : '',
      input.jd.responsibilities.length
        ? `Responsibilities:\n${input.jd.responsibilities.map((r) => `- ${r}`).join('\n')}`
        : '',
      '</target_role>',
      input.ats
        ? `<ats>\nScore ${input.ats.score}/100 · missing keywords: ${input.ats.missing_keywords.join(', ') || 'none'}\nFormatting issues: ${input.ats.formatting.issues.join('; ') || 'none'}\n</ats>`
        : '',
      '',
      'Rewrite this resume for this role. Quote the source of every line you write.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    meta: { role: input.jd.role_title, ats: input.ats?.score ?? null },
  });

  return result.data;
}
