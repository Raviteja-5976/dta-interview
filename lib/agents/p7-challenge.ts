/**
 * P7 · Coding & System Design Challenge Agent
 *
 * Produces the coding problem (with hidden tests and a reference solution) and,
 * separately, the system design scenario.
 *
 * Note the invariant that matters here: test results come from a sandbox run,
 * never from a model's opinion about whether code works (agentdesign.md §9.5).
 * This agent authors the tests; something else executes them.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import {
  codingChallengeSchema,
  designChallengeSchema,
  type CodingChallenge,
  type DesignChallenge,
  type Strategy,
} from './schemas';

const CODING_SYSTEM = `You write a single coding problem for a timed mock interview.

Constraints that matter:
- It must be solvable and explainable in 12-18 minutes by a candidate at the stated seniority. A problem nobody finishes produces no signal.
- Ground it in the role's actual domain where you can. A backend candidate parsing log lines beats an abstract tree puzzle — same algorithmic content, and it gives them something to reason about out loud.
- Avoid problems that hinge on one obscure trick. You are measuring reasoning, not recall of a specific technique.
- visible_tests are shown to the candidate and cover the examples. hidden_tests must include the edge cases the naive solution misses: empty input, single element, duplicates, boundary values.
- Every hidden test's "expected" value must be correct for your reference_solution. Verify each one by tracing the solution before writing it down. A wrong expected value fails a correct candidate and is the single worst defect this agent can ship.
- hints escalate: the first nudges toward the right question, the last names the approach. Never give code in a hint.
- starter_code has the signature and nothing else. No partial implementation.`;

const DESIGN_SYSTEM = `You write a system design scenario for a timed mock interview.

- Scope it to what can be discussed in 15-20 minutes. "Design Twitter" is not a question, it is a genre.
- Give concrete scale targets. "Handle a lot of traffic" gives the candidate nothing to reason against; "40k writes/sec, 500ms p99 read" does.
- expected_components are what a strong answer covers. Mark as must_have only what the design genuinely fails without.
- discussion_probes are the trade-off questions to ask once a design is on the table — the places where a candidate reveals whether they understand their own choices.`;

export interface ChallengeInput {
  roleTitle: string;
  seniority: string;
  prioritySkills: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  strategy?: Strategy;
}

/**
 * Problem shapes, assigned by position so a multi-problem round covers different
 * ground. Generation runs in parallel, so the problems cannot coordinate with
 * each other — giving each slot a distinct shape and a distinct skill is what
 * stops a three-problem round being the same problem three times.
 */
const CODING_SHAPES = [
  'a data-manipulation problem: parsing, grouping or transforming records',
  'an algorithmic problem where the naive solution is too slow and the candidate must find the better one',
  'a stateful problem: something that has to maintain and update a structure as input arrives',
];

const DESIGN_SHAPES = [
  'a read-heavy system where caching and consistency are the real questions',
  'a write-heavy ingestion system where throughput and durability are the real questions',
  'a system with a hard latency budget where the trade-offs are about doing less work',
];

export async function runCodingChallenge(
  input: ChallengeInput,
  context?: RunContext,
  slot = 0,
): Promise<CodingChallenge> {
  const focusSkill = input.prioritySkills[slot % Math.max(1, input.prioritySkills.length)];

  const result = await runAgent({
    agent: 'P7',
    schema: codingChallengeSchema,
    system: CODING_SYSTEM,
    prompt: [
      `Role: ${input.roleTitle} (${input.seniority})`,
      `Difficulty: ${input.difficulty}`,
      `Skills this interview is investigating: ${input.prioritySkills.join(', ') || 'general backend fundamentals'}`,
      focusSkill ? `Anchor this problem to: ${focusSkill}` : '',
      `Write ${CODING_SHAPES[slot % CODING_SHAPES.length]}.`,
      'Provide starter code in Python, JavaScript, and Java.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    meta: { kind: 'coding', difficulty: input.difficulty, slot },
  });
  return result.data;
}

export async function runDesignChallenge(
  input: ChallengeInput,
  context?: RunContext,
  slot = 0,
): Promise<DesignChallenge> {
  const result = await runAgent({
    agent: 'P7',
    schema: designChallengeSchema,
    system: DESIGN_SYSTEM,
    prompt: [
      `Role: ${input.roleTitle} (${input.seniority})`,
      `Difficulty: ${input.difficulty}`,
      `Skills this interview is investigating: ${input.prioritySkills.join(', ') || 'general distributed systems'}`,
      `Write ${DESIGN_SHAPES[slot % DESIGN_SHAPES.length]}.`,
    ].join('\n'),
    context,
    meta: { kind: 'design', difficulty: input.difficulty, slot },
  });
  return result.data;
}

/** What gets stored in `sessions.coding_challenge` / `sessions.design_challenge`. */
export interface ChallengeSet<T> {
  v: 2;
  count: number;
  challenges: T[];
}

/**
 * A round of 1-3 challenges, generated in parallel.
 *
 * `allSettled` rather than `all`: if the third problem fails to generate, a
 * two-problem round is still a perfectly good interview. Failing the whole
 * session because one of three came back empty would be absurd.
 */
export async function runCodingChallengeSet(
  input: ChallengeInput,
  count: number,
  context?: RunContext,
): Promise<ChallengeSet<CodingChallenge>> {
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => runCodingChallenge(input, context, i)),
  );

  const challenges = results
    .filter((r): r is PromiseFulfilledResult<CodingChallenge> => r.status === 'fulfilled')
    .map((r) => r.value);

  return { v: 2, count: challenges.length, challenges };
}

export async function runDesignChallengeSet(
  input: ChallengeInput,
  count: number,
  context?: RunContext,
): Promise<ChallengeSet<DesignChallenge>> {
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => runDesignChallenge(input, context, i)),
  );

  const challenges = results
    .filter((r): r is PromiseFulfilledResult<DesignChallenge> => r.status === 'fulfilled')
    .map((r) => r.value);

  return { v: 2, count: challenges.length, challenges };
}
