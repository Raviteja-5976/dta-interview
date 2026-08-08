import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only the agent pipeline uses this: prep and evaluation write artifacts the
 * user is not permitted to write themselves (blueprints, scores, reports), and
 * `company_cache` / `agent_runs` have RLS on with no policies at all, so the
 * service role is the only way in.
 *
 * NEVER import this from a Client Component or anything under app/ that renders
 * in the browser — the key would be inlined into the bundle. It is imported only
 * from route handlers and lib/ modules those handlers call.
 */

let cached: SupabaseClient | null = null;

export class MissingServiceRoleKeyError extends Error {
  constructor() {
    super(
      'SUPABASE_SERVICE_ROLE_KEY is not set. The agent pipeline needs it to write ' +
        'blueprints, reports and agent_runs. Copy it from Supabase → Project Settings → API.',
    );
    this.name = 'MissingServiceRoleKeyError';
  }
}

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.');
  if (!serviceKey) throw new MissingServiceRoleKeyError();

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** True when the service role is available, for graceful degradation. */
export function hasServiceRole(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}
