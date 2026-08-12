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
import { VOICE_CATALOG, ttsCostUsd } from '@/lib/ai/catalog';
import { prosodyToInstructions, resolveVoiceProvider } from '@/lib/ai/voice';
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

    const provider = resolveVoiceProvider();
    if (provider !== 'openai') {
      return failure(501, 'Streaming speech is only wired up for OpenAI right now.');
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return failure(503, 'Speech is not configured.');

    const params = request.nextUrl.searchParams;
    const rate = Number(params.get('rate'));
    const instructions = prosodyToInstructions({
      emotion: params.get('emotion') ?? 'neutral',
      rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
      emphasis: params.get('emphasis')?.split('|').filter(Boolean) ?? [],
    });

    const started = Date.now();

    /*
     * The raw endpoint rather than the SDK's generateSpeech, which resolves to a
     * complete Uint8Array. Streaming is the entire point here — buffering the
     * response would put us back where we started.
     */
    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VOICE_CATALOG.openai.tts.id,
        input: text,
        voice: params.get('voice') || 'alloy',
        instructions,
        response_format: 'mp3',
        // `speed` and `instructions` fight each other on gpt-4o-mini-tts — the
        // prose direction already carries pace, and sending both makes delivery
        // lurch. Prosody rate reaches the model through the instruction.
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok || !upstream.body) {
      console.error('[speak] upstream failed', upstream.status, (await upstream.text()).slice(0, 200));
      // Text is already on screen; the turn continues without audio rather than
      // failing (invariant 12 — degrade texture, not the run).
      return failure(502, 'Speech synthesis failed.');
    }

    recordAgentRun({
      agent: 'L4',
      phase: 'live',
      provider: 'openai',
      model: VOICE_CATALOG.openai.tts.id,
      latencyMs: Date.now() - started,
      costUsd: ttsCostUsd('openai', text.length),
      ok: true,
      context: { projectId: session.project_id, sessionId },
      meta: { step: 'tts', characters: text.length, streamed: true },
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
