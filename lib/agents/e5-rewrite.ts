/**
 * E5 · Rewrite Coach Agent
 *
 * Produces the improved/ideal pair that the report defaults to. sitemap-workflow
 * §11 makes "Better version of what you said" the default tab because it is the
 * one people can act on — an ideal answer they could not have given is
 * aspirational; their own answer, tightened, is a lesson.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import type { GradingMode } from '../engine/types';
import { rewriteSchema, type Grading, type Rewrite } from './schemas';

const SYSTEM = `You coach a candidate on how to say what they already said, better.

You produce two versions:

**improved** — THEIR answer, rewritten. This is the constrained one and the one that matters.
- Use only facts, projects and experiences they actually mentioned. Invent nothing.
- Keep their voice. If they are plain-spoken, stay plain-spoken.
- Fix what was actually wrong with it: bury the lede, wandering structure, a claim with no evidence, an unfinished thought, a trade-off left unstated.
- It must be speakable aloud in roughly the same time as the original. This is a voice interview; a beautifully-written paragraph they could never say is useless.
- If their answer was already good, say so by changing little. Do not manufacture improvement.

**ideal** — what a strong candidate for this role would have said.
- This one may include specifics they did not have. It is the standard, not a rewrite.
- Keep it realistic: something a real person says out loud in under 90 seconds, not a textbook entry.

**one_change** — the single highest-leverage thing. One sentence, addressed to them directly, phrased as an action: "Lead with the outcome, then explain how you got there." Not "be more structured".

Never mention scores. Never say "you scored poorly on". The grading observations are your input, not your subject.`;

export interface RewriteInput {
  questionText: string;
  transcript: string;
  grading: Grading;
  gradingMode: GradingMode;
  roleTitle: string;
}

export async function runRewriteCoach(
  input: RewriteInput,
  context?: RunContext,
): Promise<Rewrite> {
  const missing = input.grading.concept_coverage
    .filter((c) => c.status !== 'covered')
    .map((c) => c.signal_id);

  const result = await runAgent({
    agent: 'E5',
    schema: rewriteSchema,
    system: SYSTEM,
    prompt: [
      `Role: ${input.roleTitle} · grading mode: ${input.gradingMode}`,
      `<question>\n${input.questionText}\n</question>`,
      `<their_answer>\n${input.transcript}\n</their_answer>`,
      `<what_was_missing>\n${missing.join(', ') || 'nothing significant'}\n</what_was_missing>`,
      input.grading.incorrect_claims.length
        ? `<corrections_needed>\n${input.grading.incorrect_claims.map((c) => `${c.claim} → ${c.correction}`).join('\n')}\n</corrections_needed>`
        : '',
      '',
      'Write the improved and ideal versions.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
  });

  return result.data;
}
