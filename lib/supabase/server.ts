import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Request-scoped Supabase client carrying the signed-in user's session.
 *
 * Use this for anything the user is allowed to do themselves — RLS applies, which
 * is the point. In particular `spend_credits()` reads `auth.uid()`, so it must be
 * called through this client and never through the service-role one.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // proxy.ts refreshes the session, so this is safe to swallow.
          }
        },
      },
    },
  );
}

/** The authenticated user, or null. Always verifies against the auth server. */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Same, but throws — for route handlers that have already been guarded. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'UnauthorizedError';
  }
}
