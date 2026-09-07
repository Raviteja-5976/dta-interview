/**
 * SV · Skill Challenge Validator
 *
 * Reads what the candidate wrote in the editor and says which of the
 * challenge's requirements it actually meets.
 *
 * ── Why this is not the coding round's grader ────────────────────────────────
 * The coding round has a sandbox. Its pass rate is measured, and §9.5 forbids
 * asking a model whether code works when a runner can be asked instead.
 *
 * Nothing can run a React component here, or tell you whether a SQL query
 * returns the right rows without a database with the right rows in it. So the
 * skill round is judged by reading — but judged against requirements P7 wrote
 * BEFORE the interview started, which is what keeps it from being an opinion.
 * SV says met / partial / not met per requirement; S1 turns that into a number
 * by formula (invariant 7: models emit observations, S1 emits numbers).
 *
 * ── Why it runs at evaluation time and not on submit ─────────────────────────
 * Two reasons, and the first is a rule. Invariant R5: nothing evaluative reaches
 * the candidate during the interview, because knowing how you did changes how
 * you answer the next question and corrupts everything measured after it. The
 * second is latency — this is the deep tier with high reasoning effort, and
 * making someone watch a spinner for thirty seconds after pressing Submit is a
 * bad trade for a verdict they are not allowed to see.
 *
 * ── Why the deep tier ────────────────────────────────────────────────────────
 * It is reading real code against a real reference solution and deciding
 * whether a subtly different approach still satisfies the requirement. A cheap
 * model marks anything that does not look like the reference as not met, which
 * fails candidates for solving the problem a different way — the same class of
 * defect as a wrong expected value in a hidden test.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { skillValidationSchema, type SkillChallenge, type SkillValidation } from './schemas';

const SYSTEM = `You review one piece of work a candidate produced in a code editor during a mock interview, against the requirements written for it before the interview started.

You produce OBSERVATIONS, not a grade. There is no overall score in your output and you must not try to imply one — a separate deterministic component does the arithmetic from what you report.

## The requirements are the contract

For every requirement you are given, decide:
- yes — the submission does this. Quote the line or expression that does it.
- partial — it is attempted or half-done. Quote what is there and say what is missing.
- no — it is absent or wrong. Say what you looked for.

Report on every requirement you were given, using the id exactly as given. Do not invent requirements, and do not withhold credit for something that was not asked for.

## Judge the work, not the resemblance

You are given a reference solution. It is ONE correct answer, not the only one. A candidate who solves the problem differently, with different names, a different helper, a different but valid library call, has met the requirement. Mark it met.

What actually costs credit is behaviour: code that would not run, would produce the wrong result, or would break under the conditions the requirement names.

Read for intent where the syntax is imperfect. This is written under time pressure in a browser with no type checking and no way to run anything — a missing import, a typo in a variable name used consistently, an unclosed bracket at the very end are not the thing being measured. A wrong algorithm, a mutation of state that should have been copied, a query that silently drops rows: those are.

## Debug tasks

You are told what the planted fault was. The candidate had to find it.
- bug_found: yes only if they actually removed that fault. Fixing something else, or rewriting around it without addressing it, is partial at best.
- A submission that finds and fixes the fault has done the main thing even if their fix is inelegant.
- A submission that changes nothing meaningful has not, however tidy it looks.

## Design tasks

There is no code — it is a written outline of a system. Judge it as an interviewer would: are the components right, do the trade-offs get named, does it survive the numbers in the prompt. Prose that lists technologies without saying what they do is thin, however many of them there are. code_quality here means how clearly the design is expressed.

## The other fields

- correctness: whether this does the job asked of it. 10 is a submission you would accept from a colleague; 5 is the right shape with a real problem in it; 0 does not address the task.
- code_quality: naming, structure, and idiom FOR THIS TECHNOLOGY — hooks used correctly in React, set-based thinking in SQL, vectorised operations in pandas. Not formatting, not brace placement, not personal style.
- defects: real problems, not preferences. Most good submissions have none, and an empty array is a normal outcome. Say where each one is.
- summary: two or three sentences the candidate would find useful, written to them. Direct, specific, no praise sandwich.
- verdict: strong / acceptable / weak / incorrect, on the work as a whole.`;

export interface SkillValidationInput {
  challenge: SkillChallenge;
  /** What the candidate left in the editor. */
  source: string;
  /**
   * What they said while working, if anything.
   *
   * Context only — SV judges the artifact. Verbal reasoning is E4's to observe,
   * from the same transcript, and scoring it twice would double-count it.
   */
  spokenContext?: string;
}

export async function runSkillValidation(
  input: SkillValidationInput,
  context?: RunContext,
): Promise<SkillValidation> {
  const { challenge } = input;

  const result = await runAgent({
    agent: 'SV',
    schema: skillValidationSchema,
    system: SYSTEM,
    prompt: [
      `SKILL: ${challenge.skill}`,
      `FORMAT: ${challenge.format}`,
      `LANGUAGE: ${challenge.editor_language}`,
      '',
      `<task>\n${challenge.prompt}\n</task>`,
      challenge.context ? `<given_context>\n${challenge.context}\n</given_context>` : '',
      `<requirements>\n${JSON.stringify(challenge.requirements)}\n</requirements>`,
      // Only present on debug tasks, and it is the whole basis for `bug_found`.
      challenge.bug_summary
        ? `<planted_fault>\n${challenge.bug_summary}\n</planted_fault>`
        : '',
      `<starter_code>\n${challenge.starter_code.slice(0, 4000)}\n</starter_code>`,
      `<reference_solution>\n${challenge.reference_solution.slice(0, 6000)}\n</reference_solution>`,
      '',
      // Bounded: a candidate who pasted something enormous must not be able to
      // push the requirements out of the context window.
      `<submission>\n${input.source.slice(0, 12_000)}\n</submission>`,
      input.spokenContext
        ? `<what_they_said_while_working>\n${input.spokenContext.slice(0, 2000)}\n</what_they_said_while_working>`
        : '',
      '',
      'Review the submission against the requirements. Observations only — no overall score.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    meta: { skill: challenge.skill, format: challenge.format },
  });

  return result.data;
}
