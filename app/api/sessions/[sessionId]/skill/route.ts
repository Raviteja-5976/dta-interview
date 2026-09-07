/**
 * POST /api/sessions/[sessionId]/skill — submit the skill-challenge answer.
 *
 * There is no `run` action here, and that is not an omission. The coding round
 * has Judge0 behind it, so "run my code" means something; nothing in this system
 * can render a React component, execute a query against a schema that exists
 * only in a prompt, or import torch. The skill round is reviewed after the
 * interview by SV (lib/agents/sv-validate.ts) against the requirements P7 wrote
 * before it started.
 *
 * So this route records and nothing else — no model call, no verdict, and
 * nothing evaluative in the response. Two reasons:
 *
 *   Invariant R5. Nothing that tells a candidate how they did may reach them
 *   during the interview. Knowing changes how they answer the next question,
 *   and it corrupts every measurement taken after it.
 *
 *   Latency. SV runs on the deep tier with high reasoning effort. Making
 *   someone watch a spinner for half a minute to receive a verdict they are not
 *   allowed to see would be the worst of both.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SkillChallenge } from '@/lib/agents/schemas';
import type { ChallengeSet } from '@/lib/agents/p7-challenge';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 30;

interface SkillBody {
  challengeIndex?: number;
  source: string;
  /** Seconds the candidate had the task open. Recorded for the report, not billed. */
  elapsedSec?: number;
}

/** Bounded so one paste cannot put a megabyte of text into `live_state`. */
const MAX_SOURCE_CHARS = 20_000;

export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/skill'>) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, status, skill_challenge, live_state')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    const body = (await request.json()) as SkillBody;
    if (!body.source?.trim()) return failure(400, 'There is nothing to submit.');

    const set = session.skill_challenge as ChallengeSet<SkillChallenge> | null;
    const index = body.challengeIndex ?? 0;
    const challenge = set?.challenges?.[index];
    if (!challenge) return failure(409, 'This interview has no skill challenge.');

    /*
     * Written with the service role. `live_state` is the orchestrator's, and a
     * browser that could write into it could write its own submission history —
     * including how many tasks it had already finished, which is what decides
     * whether the next one opens.
     */
    const admin = createAdminClient();
    const state = (session.live_state ?? {}) as Record<string, unknown>;
    const submissions = Array.isArray(state.skill_submissions) ? state.skill_submissions : [];

    /*
     * Append-only, and re-submitting appends again rather than replacing.
     *
     * That is deliberate: `skillPayload` opens the next task once the count
     * reaches the number of challenges, so overwriting in place would let a
     * candidate sit on one task forever, while appending means a second submit
     * moves the round on. The evaluator reads the LAST submission for each
     * challenge index, so nobody is graded on a draft they replaced.
     */
    const { error } = await admin
      .from('sessions')
      .update({
        live_state: {
          ...state,
          skill_submissions: [
            ...submissions,
            {
              challenge_index: index,
              skill: challenge.skill,
              format: challenge.format,
              title: challenge.title,
              language: challenge.editor_language,
              source: body.source.slice(0, MAX_SOURCE_CHARS),
              elapsed_sec: Math.max(0, Math.round(body.elapsedSec ?? 0)),
              submitted_at: new Date().toISOString(),
            },
          ],
        },
      })
      .eq('id', sessionId);

    if (error) {
      // The candidate's work is in the editor, not lost — but they must know it
      // did not land, because the interviewer is about to move on.
      console.error('[skill] submission write failed', sessionId, error.message);
      return failure(500, 'We could not save that submission. Try submitting again.');
    }

    return ok({
      recorded: true,
      challengeIndex: index,
      /*
       * Whether the round continues, so the client knows if it is going back to
       * the editor or back to the conversation. Not a verdict — this is the
       * only thing the browser learns about a submission until the report.
       */
      remaining: Math.max(0, (set?.challenges.length ?? 0) - (submissions.length + 1)),
      message: 'Submitted. Your interviewer will pick this up from here.',
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
