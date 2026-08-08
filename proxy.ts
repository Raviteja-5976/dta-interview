/**
 * Auth guards and Supabase session refresh.
 *
 * Note the filename: Next.js 16 deprecated `middleware.ts` and renamed the
 * convention to `proxy.ts`. Same behaviour, different export name.
 *
 * Guards implement sitemap-workflow.md §15:
 *   not authenticated on an (app) route  → /auth?next=<path>
 *   authenticated on /auth               → /dashboard
 *
 * Ownership guards are NOT here. A project that is not yours simply is not
 * visible through RLS, so the page 404s — and a 404 is the correct answer, since
 * a 403 confirms the resource exists.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Everything under these prefixes requires a session. */
const PROTECTED_PREFIXES = ['/dashboard', '/projects', '/sessions', '/interview', '/credits', '/settings', '/profile'];

/** Signed-in users get bounced off these to the dashboard. */
const AUTH_ROUTES = ['/auth', '/login', '/register'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase configured there is no session to check; let everything
  // through rather than locking the developer out of their own app.
  if (!url || !anonKey || url.includes('placeholder')) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Must be getUser(), not getSession(): only getUser revalidates the token
  // against the auth server. getSession trusts a cookie that could be forged.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/auth';
    // Preserved through the whole round trip, including OAuth, so a user who
    // was deep-linked to a report lands back on it.
    redirect.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(redirect);
  }

  if (user && AUTH_ROUTES.includes(path)) {
    const next = request.nextUrl.searchParams.get('next');
    const redirect = request.nextUrl.clone();
    redirect.pathname = next && next.startsWith('/') ? next.split('?')[0] : '/dashboard';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. API routes are included
     * so their cookies get refreshed; each one still calls requireUser() itself.
     *
     * The Razorpay webhook is excluded: it carries no session, its signature is
     * its authentication, and running a getUser() round trip on every retry
     * would be pure waste.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/payments/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav)$).*)',
  ],
};
