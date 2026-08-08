/**
 * POST /api/sessions/[sessionId]/transcribe — L5's speech-to-text leg.
 *
 * Takes a recorded answer and returns the transcript WITH word-level timestamps.
 * Those timestamps are the entire basis of E2, so `hasWordTimings: false` in the
 * response is a real signal, not a detail — it means fluency for that answer
 * will be reported as unavailable rather than guessed at.
 *
 * This is the batch endpoint. True streaming STT with semantic end-of-utterance
 * detection is the remaining piece of L5; see the note in the build summary.
 */

import type { NextRequest } from 'next/server';

import { requireUser, createSupabaseServerClient } from '@/lib/supabase/server';
import { transcribeAnswer } from '@/lib/ai/voice';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 120;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/transcribe'>) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, project_id, config')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File)) return failure(400, 'An audio file is required.');
    if (audio.size > MAX_AUDIO_BYTES) return failure(400, 'That recording is too large.');

    const config = session.config as { language?: string };
    const result = await transcribeAnswer(await audio.arrayBuffer(), {
      language: config.language ?? 'en-IN',
      context: { userId: session.user_id, projectId: session.project_id, sessionId },
    });

    return ok({
      transcript: result.text,
      words: result.words,
      durationSec: result.durationSec,
      wordCount: result.words.length,
      hasWordTimings: result.hasWordTimings,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
