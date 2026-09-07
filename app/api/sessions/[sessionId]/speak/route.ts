/**
 * GET /api/sessions/[sessionId]/speak — streams one spoken segment.
 *
 * ── Why this is a GET with the text in the query ─────────────────────────────
 * So that `<audio src="...">` can point straight at it. The browser then streams
 * and decodes MP3 frames as they arrive, which means the interviewer starts
 * talking a few hundred milliseconds after the turn resolves rather than after
 * a whole file has been synthesized, uploaded to Storage and signed.
 *
 * It also being same-origin fixes a second thing for free: the request carries
 * the session cookie, and feeding a same-origin element into
 * `createMediaElementSource` never taints the Web Audio graph — the failure mode
 * that silently routed silence when a cross-origin clip lost its CORS headers.
 *
 * ── On not persisting these ──────────────────────────────────────────────────
 * A live segment is unique to one turn and is never read again. P8's prepared
 * clips are the ones worth caching, and those still come from Storage; the turn
 * route only points here when the cache misses.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { ttsCostUsd } from '@/lib/ai/catalog';
import {
  DEEPGRAM_TTS_MODEL,
  isDeepgramConfigured,
  openSpeechStream,
  voiceForPersona,
} from '@/lib/ai/deepgram';
import { prosodyToInstructions } from '@/lib/ai/voice';
import { recordAgentRun } from '@/lib/ai/telemetry';
import { failure, handleRouteError, notFound } from '@/lib/api/respond';

export const maxDuration = 60;

/**
 * An utterance is one or two sentences. The cap is what stops this being a
 * general-purpose TTS endpoint for anyone with an account.
 */
const MAX_CHARS = 600;

export async function GET(request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/speak'>) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    const text = request.nextUrl.searchParams.get('text')?.trim();
    if (!text) return failure(400, 'Nothing to say.');
    if (text.length > MAX_CHARS) return failure(413, 'That utterance is too long to speak.');

    // Ownership, not just authentication: the session id is in the path and RLS
    // is what decides whether this user can see it.
    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, project_id')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    if (!isDeepgramConfigured()) return failure(503, 'Speech is not configured.');

    const params = request.nextUrl.searchParams;

    /*
     * The voice is chosen from the persona, and it is the ONLY delivery control
     * Aura exposes.
     *
     * L4's prosody still arrives on the query string and is still computed, but
     * Deepgram takes no delivery direction, so `instructions` is logged rather
     * than sent — see the note in lib/ai/voice.ts. Recording it keeps the turn
     * replayable (invariant 14) and keeps the gap visible in `agent_runs`
     * instead of it looking like L4 never had an opinion.
     */
    const rate = Number(params.get('rate'));
    const instructions = prosodyToInstructions({
      emotion: params.get('emotion') ?? 'neutral',
      rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
      emphasis: params.get('emphasis')?.split('|').filter(Boolean) ?? [],
    });

    const model = params.get('voice') || voiceForPersona(params.get('persona') ?? '');

    const started = Date.now();

    /*
     * The raw endpoint rather than a buffered helper. Streaming is the entire
     * point here — resolving the whole MP3 first would put us back where we
     * started, with the candidate listening to silence while a file is built.
     */
    const upstream = await openSpeechStream(text, { model, encoding: 'mp3' });

    if (!upstream.ok || !upstream.body) {
      console.error('[speak] upstream failed', upstream.status, (await upstream.text()).slice(0, 200));
      // Text is already on screen; the turn continues without audio rather than
      // failing (invariant 12 — degrade texture, not the run).
      return failure(502, 'Speech synthesis failed.');
    }

    recordAgentRun({
      agent: 'IV',
      phase: 'live',
      provider: 'deepgram',
      model: model || DEEPGRAM_TTS_MODEL,
      latencyMs: Date.now() - started,
      costUsd: ttsCostUsd('deepgram', text.length),
      ok: true,
      context: { projectId: session.project_id, sessionId },
      meta: {
        step: 'tts',
        characters: text.length,
        streamed: true,
        // Recorded, not sent. See above.
        prosody_intent: instructions,
      },
    });

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        // Private and unstored: this is one turn of one candidate's interview.
        'Cache-Control': 'private, no-store',
        // No range support, stated explicitly. A browser that retried with a
        // Range header would re-synthesize the same sentence and bill for it
        // twice; saying so up front keeps playback to one request.
        'Accept-Ranges': 'none',
        // Lets the element start decoding instead of waiting on a length it will
        // never get — the upstream response is chunked.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
