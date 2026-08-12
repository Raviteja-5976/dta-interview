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
- Include a coding or system_design section ONLY if the corresponding module is enabled in the config given to you.
- stop_rules are the conditions under which a section should be cut short — write them as observable conditions, e.g. "candidate has disclaimed hands-on experience with the topic twice".`;

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
    systemDesign: boolean;
    focusSkills?: string[];
  };
}

export async function runStrategy(
  input: StrategyInput,
  context?: RunContext,
): Promise<Strategy> {
  const focus = input.config.focusSkills?.length
    ? `The candidate explicitly asked to focus on: ${input.config.focusSkills.join(', ')}. Weight these up.`
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
      `<config>\nLength: ${input.config.minMinutes}-${target} minutes\nDifficulty: ${input.config.difficulty}\nCoding module: ${input.config.coding ? 'ENABLED' : 'disabled'}\nSystem design module: ${input.config.systemDesign ? 'ENABLED' : 'disabled'}\n</config>`,
      focus,
      `Plan the interview to fill ${target} minutes — section minutes must sum to exactly ${target}. It may end as early as ${input.config.minMinutes} minutes if the candidate is brief, so order the sections by what matters most: whatever you schedule last is what gets lost.`,
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
