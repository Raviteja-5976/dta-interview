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
- Always open with a short intro section (60-90s) and close with a short closing section. Both are conversationally necessary and neither should eat investigation time.
- Allocate the remaining time in proportion to investigation_priority from the gap report, not evenly across skills. An interview that spends equal time on everything establishes nothing about anything.
- A 15-minute interview can genuinely investigate two or three things. Do not plan six sections into it. Fewer goals investigated properly beats broad shallow coverage — the report is built on established evidence, and a section that ran out of time produces none.
- difficulty_curve.start_level should sit slightly below the candidate's apparent level so the first answer succeeds. People who fail the opening question perform worse for the rest of the interview, which corrupts everything measured after it.
- Include a coding or system_design section ONLY if the corresponding module is enabled in the config given to you.
- stop_rules are the conditions under which a section should be cut short — write them as observable conditions, e.g. "candidate has disclaimed hands-on experience with the topic twice".`;

export interface StrategyInput {
  gap: GapReport;
  jd: JdProfile;
  config: {
    durationMin: number;
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

  const result = await runAgent({
    agent: 'P5',
    schema: strategySchema,
    system: SYSTEM,
    prompt: [
      `<gap_report>\n${JSON.stringify(input.gap)}\n</gap_report>`,
      `<role>\n${input.jd.role_title} · seniority: ${input.jd.seniority}\n</role>`,
      `<config>\nDuration: ${input.config.durationMin} minutes\nDifficulty: ${input.config.difficulty}\nCoding module: ${input.config.coding ? 'ENABLED' : 'disabled'}\nSystem design module: ${input.config.systemDesign ? 'ENABLED' : 'disabled'}\n</config>`,
      focus,
      `Plan the interview. Section minutes must sum to exactly ${input.config.durationMin}.`,
    ].join('\n\n'),
    context,
    meta: { duration_min: input.config.durationMin, difficulty: input.config.difficulty },
  });
  return result.data;
}
