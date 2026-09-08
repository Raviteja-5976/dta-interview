/**
 * The admin gate.
 *
 * One rule, applied in two places: `app/admin/layout.tsx` gates the pages so a
 * student never sees the console, and every `/api/admin/*` handler calls
 * `requireAdmin()` itself. The layout check is UX; the route check is the
 * security boundary. A page guard that route handlers trust is a page guard
 * someone bypasses with curl.
 *
 * The role is read through the USER's client, not the service role — it is their
 * own row, `profiles_select` allows exactly that, and reading it any other way
 * would mean the gate trusts something the caller could influence.
 */

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';

/**
 * Not an authorization error on purpose.
 *
 * `lib/api/respond.ts` maps this to a 404, following the same 404-not-403 rule
 * the rest of the app uses: a 403 from /api/admin/users confirms there is an
 * admin console to go looking for.
 */
export class AdminOnlyError extends Error {
  constructor() {
    super('Admin only');
    this.name = 'AdminOnlyError';
  }
}

export interface AdminUser {
  id: string;
  email: string | null;
}

/** Throws `AdminOnlyError` unless the caller is `profiles.role = 'admin'`. */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await requireUser();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if ((data as { role?: string } | null)?.role !== 'admin') {
    throw new AdminOnlyError();
  }

  return { id: user.id, email: user.email ?? null };
}

/** Same check, no throw — for the layout, which redirects rather than responds. */
export async function isAdmin(): Promise<boolean> {
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}
