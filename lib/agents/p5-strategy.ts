/**
 * P5 · Interview Strategy Agent
 *
 * Decides the *shape* of the interview — how the minutes are spent, which skills
 * get the time, how difficulty moves — without writing a single question.
 * Small output, high leverage: P6 works inside whatever envelope this defines.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { strategySchema, type GapReport, type JdProfile, type Strategy } from './schemas';

const SYSTEM = `You plan the shape of a mock interview. You do not write questions — a later agent does that. You decide where the time goes and how hard it should get.

Rules that make the plan realistic:

- The minutes must sum to the total. Interviews overrun; plans should not.
- The FIRST section is always type "intro" and is always a warm-up. 60-90 seconds, one goal, and its purpose is to get the candidate talking comfortably — not to investigate anything. Someone who is asked a hard technical question in the first thirty seconds performs worse for the entire rest of the interview, and every measurement taken afterwards is degraded by it. Treat the intro as protecting your own data.
- The LAST section is always a short closing.
- Allocate the remaining time in proportion to investigation_priority from the gap report, not evenly across skills. An interview that spends equal time on everything establishes nothing about anything.
- A 15-minute interview can genuinely investigate two or three things. Do not plan six sections into it. Fewer goals investigated properly beats broad shallow coverage — the report is built on established evidence, and a section that ran out of time produces none.
- difficulty_curve.start_level should sit slightly below the candidate's apparent level so the first answer succeeds. People who fail the opening question perform worse for the rest of the interview, which corrupts everything measured after it.
- Include a coding or skill_challenge section ONLY if the corresponding module is enabled in the config given to you.
- The two are different rounds. "coding" is a DSA round: one LeetCode-style algorithm problem, written in an editor and run against tests. "skill_challenge" is a hands-on task in a technology the role actually requires — a React component, a SQL query, a broken function to find the fault in — or a system design scenario where the required skill genuinely is architecture. A plan may carry either, both, or neither.
- stop_rules are the conditions under which a section should be cut short — write them as observable conditions, e.g. "candidate has disclaimed hands-on experience with the topic twice".

## Exactly one "behavioral" section, always

Every plan carries one section of type "behavioral", whatever else is in it. Not optional, not conditional on the length, not something to drop when the minutes get tight. It needs at least 4 minutes: it has to yield two full STAR answers, and nobody can tell you about a real conflict or a real failure in ninety seconds.

Its purpose is how they work with PEOPLE. A disagreement they had to resolve, something that went wrong and what they did about it, a time they had to change someone's mind. Never a technical topic wearing a behavioural costume.

If the minutes are tight, take them from the technical sections. A plan that drops this section produces a report with a behavioural score of zero, which is worse than a slightly shorter technical round.

## The mix of skills you plan against

The gap report classifies every skill. Your section purposes decide which classes get the time, and the config gives you a target split for this difficulty. Honour it:

- STRONG skills are not wasted questions. They are where the candidate shows what they are actually good at, and a report with nothing established is useless to them. Plan real sections around these, not token ones.
- WEAK is the most productive band — the role needs it and the resume only gestures at it.
- UNVERIFIED and MISSING are the highest-risk and the highest-learning. Their share grows with difficulty.
- SURPLUS gets nothing. The role does not need it.

Focus skills, when the candidate asked for them, are weighted UP inside whatever class they fall in. They change which skills are chosen, never the split between the classes.

## Difficulty is a ceiling on question complexity

The difficulty in the config is not a mood. It decides how hard a candidate is allowed to be pushed, and where the curve starts and ends:

- easy   - start_level 1, max_level 2, ramp "flat". Recall and direct experience. What they have done and how it worked. Nothing that requires holding two systems in mind at once, no design-under-constraint, no "what breaks at scale". A nervous junior who has genuinely done the work should be able to answer every question in this interview.
- medium - start_level 2, max_level 3, ramp "gentle". Applied depth. Mechanisms, trade-offs they actually faced, why they chose one thing over another. One step past "what did you use".
- hard   - start_level 2, max_level 5, ramp "steep". Design under constraint, failure modes, behaviour at scale, defending a choice against a named alternative. It still OPENS gently; the ramp is what is steep, not the first question.

Set difficulty_curve to exactly those values for the difficulty you were given. It is a contract the live interviewer reads, not a suggestion.`;

export interface StrategyInput {
  gap: GapReport;
  jd: JdProfile;
  config: {
    /**
     * The interview is planned to fill this range, not a single number.
     * Difficulty sets the band; the candidate's balance can lower the ceiling.
     */
    minMinutes: number;
    maxMinutes: number;
    difficulty: 'easy' | 'medium' | 'hard';
    coding: boolean;
    skillChallenge: boolean;
    focusSkills?: string[];
  };
}

/**
 * The complexity ceiling each difficulty buys, in the words the model reads.
 *
 * P5 gets this as prose in its system message; P6 and the live interviewer get
 * this constant. Three components describing "hard" three different ways is how
 * an easy interview ends up asking a system-design question, so there is one
 * wording and everything imports it.
 */
export const DIFFICULTY_BRIEF: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'EASY. Recall and direct experience only: what they have done, how it worked, what a tool is for. No design-under-constraint, no scale questions, no "what breaks when". Every question must be answerable by a nervous junior who has genuinely done the work. Never stack two concepts into one question.',
  medium:
    'MEDIUM. Applied depth: mechanisms, trade-offs they actually faced, why they chose this over that. One step past "what did you use", but never a question that needs two systems held in mind at once.',
  hard: 'HARD. Design under constraint, failure modes, behaviour at scale, defending a choice against a named alternative. Push until they reach the edge of what they know. The OPENING question is still gentle; the ramp is what is steep.',
};

/**
 * How the questions are split across the gap report, by difficulty.
 *
 * P4 classifies every skill STRONG / WEAK / UNVERIFIED / MISSING / SURPLUS, and
 * until now nothing downstream had a target for how much airtime each class got
 * — sections were sized by `investigation_priority` alone, which is weighted
 * hard towards doubt. That is right for what an interview LEARNS and wrong for
 * what an interview should FEEL like: an easy round that only asks about things
 * the resume cannot evidence is an easy round in name only.
 *
 * So the mix is stated as a quota, and it moves with difficulty:
 *
 *   strong          — skills the resume genuinely evidences. These are the
 *                     questions someone can answer well, and they are what
 *                     stops the interview being an hour of being caught out.
 *   weak_medium     — WEAK: the role needs it, the resume gestures at it. The
 *                     most productive band at every level, so it is 40%
 *                     throughout; the other two are what trade against each
 *                     other.
 *   not_established — UNVERIFIED and MISSING together. The highest-risk, and
 *                     the share that grows as the interview gets harder.
 *
 * SURPLUS is excluded everywhere: it is on the resume and the role does not
 * need it, so a question about it measures nothing this interview exists for.
 */
export interface SkillMix {
  strong: number;
  weak_medium: number;
  not_established: number;
}

export const SKILL_MIX: Record<'easy' | 'medium' | 'hard', SkillMix> = {
  easy: { strong: 0.4, weak_medium: 0.4, not_established: 0.2 },
  medium: { strong: 0.3, weak_medium: 0.4, not_established: 0.3 },
  hard: { strong: 0.2, weak_medium: 0.4, not_established: 0.4 },
};

/** The quota as a line of prompt, in the one wording every stage shares. */
export function skillMixBrief(difficulty: 'easy' | 'medium' | 'hard'): string {
  const m = SKILL_MIX[difficulty];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    `Across the whole interview, roughly ${pct(m.strong)} of questions should target skills the gap report marks STRONG, ` +
    `${pct(m.weak_medium)} skills marked WEAK, and ${pct(m.not_established)} skills marked UNVERIFIED or MISSING. ` +
    'Never ask about a skill marked SURPLUS. This is a target for the shape of the interview, not an exact count — ' +
    'get the balance roughly right rather than contorting a section to hit a number.'
  );
}

export async function runStrategy(
  input: StrategyInput,
  context?: RunContext,
): Promise<Strategy> {
  const focus = input.config.focusSkills?.length
    ? `FOCUS SKILLS — the candidate explicitly asked for these: ${input.config.focusSkills.join(', ')}. ` +
      'Give them a named section of their own where the minutes allow, and prefer them whenever two skills are otherwise equally worth asking about. ' +
      'They are weighted up within their gap class; they do not change the STRONG / WEAK / UNVERIFIED split above.'
    : 'No explicit focus skills were requested.';

  // Plan to the ceiling. A candidate who finishes early simply pays for less
  // time — but a plan that ran out of sections at minute twelve would leave the
  // interviewer with nothing to ask.
  const target = input.config.maxMinutes;

  const result = await runAgent({
    agent: 'P5',
    schema: strategySchema,
    system: SYSTEM,
    prompt: [
      `<gap_report>\n${JSON.stringify(input.gap)}\n</gap_report>`,
      `<role>\n${input.jd.role_title} · seniority: ${input.jd.seniority}\n</role>`,
      `<config>\nLength: ${input.config.minMinutes}-${target} minutes\nDifficulty: ${input.config.difficulty}\nCoding module (DSA): ${input.config.coding ? 'ENABLED' : 'disabled'}\nSkill challenge module: ${input.config.skillChallenge ? 'ENABLED' : 'disabled'}\n</config>`,
      `<difficulty_ceiling>${DIFFICULTY_BRIEF[input.config.difficulty]}</difficulty_ceiling>`,
      `<skill_mix>${skillMixBrief(input.config.difficulty)}</skill_mix>`,
      focus,
      `Plan the interview to fill ${target} minutes — section minutes must sum to exactly ${target}. It may end as early as ${input.config.minMinutes} minutes if the candidate is brief, so order the sections by what matters most: whatever you schedule last is what gets lost.`,
      'Include exactly one "behavioral" section of at least 4 minutes. Take the minutes from the technical sections if you have to.',
    ].join('\n\n'),
    context,
    meta: {
      min_minutes: input.config.minMinutes,
      max_minutes: target,
      difficulty: input.config.difficulty,
    },
  });
  return result.data;
}
