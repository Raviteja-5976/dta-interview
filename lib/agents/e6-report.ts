/**
 * E6 · Report Composer
 *
 * Writes the narrative sections of the report FROM NUMBERS IT IS GIVEN. It never
 * computes a score and never contradicts one — S1 already did the arithmetic
 * (invariant 7).
 *
 * It reads L3's coverage ledger directly (§2.3) so the goal-outcome claims come
 * from the live record rather than being re-derived from the transcript.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import type { Coverage } from '../engine/types';
import type { SessionScores } from '../engine/s1-scoring';
import { reportNarrativeSchema, type Blueprint, type ReportNarrative } from './schemas';

const SYSTEM = `You write the narrative of an interview report for the candidate who just sat it.

Every number you need has already been computed and is given to you. Never invent one, never recompute one, and never contradict one. If the data says 6.2, the prose does not say "strong".

## goal_outcomes — lead with this

This is the block that distinguishes the report. For each goal the interview carried, state what it was trying to find out and whether it succeeded. Use the coverage ledger given to you; it is the record of what was actually established.

The verdict line is one sentence, factual, addressed to the candidate:
  "Hands-on depth not established after three probes."
  "Design reasoning verified — you walked through the trade-off unprompted."

A goal that was not established is not a failure to report harshly. It is information: the interview could not confirm the claim. Say that plainly.

questions_asked is given to you per goal and is COUNTED from what was actually asked. Copy it exactly; never derive it from turns_spent or from the transcript.

A goal with questions_asked = 0 was never reached — the interview ran out of time before it, or went elsewhere. Its verdict says exactly that and nothing more: "Not covered — the interview did not reach this." Do not write it up as though the candidate failed to answer something they were never asked, and do not imply they avoided it.

A goal with questions_asked > 0 and no evidence verified IS a real finding: it was asked about and the answer did not establish it. That distinction is the most useful thing in this block, so make it unmistakable in the wording.

## summary

Four to six sentences. Reference actual questions and actual answers. A summary that would fit any candidate is worthless — name the specific thing that went well and the specific thing that did not.

## strengths and weaknesses

Each tied to one question by its sequence number. Weaknesses need why_it_matters: the consequence in a real interview, not a restatement of the gap.

## improvement_plan

Three to five, ranked. Each needs:
- action: something they can start this week. "Deploy a two-service app to a local k3s cluster and write every manifest by hand" — not "study Kubernetes".
- effort: honest. "one weekend", "two evenings".
- success_check: how they will KNOW it worked, stated as a capability. "You can explain readiness vs liveness vs startup probes without notes."

## speech_note

Delivery is coaching, never a verdict on competence. Frame pace and fillers as practice signals. NEVER comment on accent, pronunciation, or how "clear" they sounded — those are not measured and must not be implied. If a trend is in the data, name it as a signal, not a flaw ("filler rate rose in the second half — that reads as stress, not habit").

## Tone

Direct, warm, specific. You are a good interviewer giving honest feedback to someone who wants to get better, not a report generator. No corporate hedging, no "areas of opportunity". If they were not ready, they need to hear it clearly enough to act on it.`;

export interface ReportComposerInput {
  scores: SessionScores;
  coverage: Coverage;
  blueprint: Blueprint;
  /**
   * Every question asked, with the goal it was attributed to AS IT WAS ASKED.
   *
   * `questions_asked` used to be left to the model, which was given
   * `turns_spent` and asked for a different number — so a goal that was never
   * raised could still be written up as though it had been probed, and one
   * asked about twice could report one question. It is counted here instead,
   * from the record of what was actually said.
   */
  askedGoalIds: string[];
  roleTitle: string;
  companyName: string;
  questions: Array<{
    seq: number;
    text: string;
    transcript: string;
    accuracy?: number | null;
    oneThingToChange?: string;
    covered: number;
    total: number;
  }>;
  speechSummary: {
    wpm?: number | null;
    fillerRate?: number | null;
    longPausesPerMin?: number | null;
    reliability: 'ok' | 'low';
    trend?: string;
  };
  previousOverall?: number | null;
}

export async function runReportComposer(
  input: ReportComposerInput,
  context?: RunContext,
): Promise<ReportNarrative> {
  // Project the coverage ledger into the goal statements it belongs to, so the
  // model never has to join two structures itself.
  const askedCount = new Map<string, number>();
  for (const id of input.askedGoalIds) {
    askedCount.set(id, (askedCount.get(id) ?? 0) + 1);
  }

  const goalRows = input.coverage.goals.map((g) => {
    const statement = findGoalStatement(input.blueprint, g.goal_id);
    const verified = g.evidence.filter((e) => e.status === 'verified').length;
    return {
      goal_id: g.goal_id,
      statement,
      status: g.status,
      // Counted, never inferred. This is the number the report prints.
      questions_asked: askedCount.get(g.goal_id) ?? 0,
      evidence_verified: verified,
      evidence_total: g.evidence.length,
      depth_reached: g.depth_reached,
      turns_spent: g.turns_spent,
    };
  });

  const result = await runAgent({
    agent: 'E6',
    schema: reportNarrativeSchema,
    system: SYSTEM,
    prompt: [
      `Interview: ${input.roleTitle} at ${input.companyName}`,
      `<scores>\n${JSON.stringify(input.scores)}\n</scores>`,
      input.previousOverall != null
        ? `Previous interview in this project scored ${input.previousOverall}.`
        : 'This is the first interview in this project.',
      '',
      `<goal_outcomes_data>\n${JSON.stringify(goalRows)}\n</goal_outcomes_data>`,
      `<questions>\n${JSON.stringify(input.questions)}\n</questions>`,
      `<speech>\n${JSON.stringify(input.speechSummary)}\n</speech>`,
      '',
      'Write the report narrative.',
    ].join('\n'),
    context,
    meta: { questions: input.questions.length, goals: goalRows.length },
  });

  return result.data;
}

function findGoalStatement(blueprint: Blueprint, goalId: string): string {
  for (const section of blueprint.sections) {
    const goal = section.goals.find((g) => g.goal_id === goalId);
    if (goal) return goal.statement;
  }
  return goalId;
}
