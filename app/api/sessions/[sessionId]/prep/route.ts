/**
 * POST /api/sessions/[sessionId]/prep — P5' → P6 → P7 → P8.
 *
 * Fired by the interview screen while it shows "Building your interview…".
 * Genuinely fast, because P1-P4 already ran at project creation.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runSessionPrep } from '@/lib/pipelines/session-prep';
import { handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 300;

export async function POST(_request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/prep'>) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();
    if (session.status === 'ready' || session.status === 'live') {
      return ok({ status: session.status, alreadyPrepared: true });
    }

    const result = await runSessionPrep(createAdminClient(), sessionId);

    return ok({
      status: result.status,
      voiceAssetsCached: result.voiceAssetsCached,
      error: result.error,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
