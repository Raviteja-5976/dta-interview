/**
 * POST /api/sessions/[sessionId]/transcribe — L5's speech-to-text FALLBACK.
 *
 * The live socket (lib/speech/deepgram-live.ts) is the main road: it transcribes
 * the answer while it is being spoken, so an ordinary turn reaches /turn with
 * the transcript and its word timings already in hand and never touches this
 * route at all.
 *
 * This is what happens when that socket could not be opened — no token, a
 * blocked WebSocket, a network that dropped mid-answer. The browser still has
 * the recorded clip, so the answer is recovered here instead of lost. Same
 * model, same word timings; it just costs a second pass and its whole latency
 * lands in the silence after the candidate stops talking, which is exactly what
 * streaming exists to avoid.
 *
 * `hasWordTimings: false` in the response is a real signal, not a detail: it
 * means E2 will report that answer's pause profile as unavailable rather than
 * guessing at it.
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
      // The recorder's own container type, so Deepgram is not left guessing at
      // a WebM/Opus stream it was told was something else.
      mimeType: audio.type || 'audio/webm',
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
