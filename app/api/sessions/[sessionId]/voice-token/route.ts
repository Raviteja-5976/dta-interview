/**
 * POST /api/sessions/[sessionId]/voice-token — a short-lived Deepgram token.
 *
 * The browser holds the live STT socket (see lib/speech/deepgram-live.ts), so it
 * needs a credential. It never gets the API key. This mints a JWT that expires
 * in minutes and carries usage rights only — it cannot reach Deepgram's Manage
 * API, so a leaked one cannot read the account or rotate a key.
 *
 * Scoped to a session rather than sitting at /api/voice/token because the check
 * that matters is ownership, not authentication: the session id is in the path
 * and RLS is what decides whether this user can see it. Without that, any signed
 * -in account could mint transcription credit against our Deepgram balance for
 * whatever audio it liked.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { isDeepgramConfigured, mintAccessToken } from '@/lib/ai/deepgram';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

/**
 * Long enough that the client can mint once and reuse it across several answers
 * without a round trip sitting in front of each one, short enough that a leaked
 * token is worth little. Only the CONNECTION needs it to be valid — an open
 * socket survives its token expiring mid-answer.
 */
const TTL_SECONDS = 300;

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/sessions/[sessionId]/voice-token'>,
) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    if (!isDeepgramConfigured()) {
      return failure(503, 'Voice is not configured.', { configuration: true });
    }

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    // A finished session has nothing left to transcribe. Refusing here keeps a
    // completed interview from being a standing source of fresh tokens.
    if (session.status !== 'live' && session.status !== 'ready') {
      return failure(409, 'This interview is not live.');
    }

    const token = await mintAccessToken(TTL_SECONDS);

    return ok(
      { accessToken: token.accessToken, expiresIn: token.expiresIn },
      // Never cached, anywhere. It is a bearer credential.
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
