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
/**
 * `/admin` is here for the redirect-to-sign-in behaviour only. The role check
 * that actually gates it lives in app/admin/layout.tsx and in every
 * /api/admin/* handler — this file knows nothing about roles.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/projects', '/sessions', '/interview', '/credits', '/settings', '/profile', '/admin'];

/** Signed-in users get bounced off these to the dashboard. */
const AUTH_ROUTES = ['/auth', '/login', '/register'];

/**
 * ── Why every session-bearing response is sealed off from shared caches ──────
 *
 * This is the fix for one account being signed in for every visitor.
 *
 * Next.js serves a statically prerendered page with `Cache-Control:
 * s-maxage=31536000` (see node_modules/next/dist/docs/01-app/02-guides/
 * cdn-caching.md). Most pages here are prerendered shells: /, /auth, /dashboard,
 * /credits, /pricing, /profile, /projects/new. Meanwhile this file runs on every
 * request and, whenever Supabase rotates an access token, attaches
 * `Set-Cookie: sb-<ref>-auth-token=…` to that same response.
 *
 * A year-cacheable response carrying somebody's credentials is a loaded gun. Any
 * shared cache in front of the app — a CDN, a reverse proxy, a corporate
 * middlebox — stores the HTML *and the Set-Cookie header*, then hands both to
 * the next person who asks for that URL. They arrive holding the first user's
 * refresh token and the app is, correctly as far as it can tell, signed in as
 * that user. Session fixation by cache, and it pins whichever account happened
 * to refresh first.
 *
 * So: a response that carries a session, or whose content depends on one, is
 * never storable by a shared cache. Marketing pages requested by a signed-out
 * visitor carry no credentials and stay fully cacheable, which is the whole
 * point of keeping the rule narrow.
 *
 * `send-payload.js` only fills in `Cache-Control` when the header is not already
 * set, and proxy headers are applied before the render, so what we set here is
 * what ships. next.config.ts repeats the rule declaratively for the same paths,
 * which keeps it true even for a deployment that puts its CDN in front of this
 * file rather than behind it.
 */
const NO_STORE = 'private, no-store, max-age=0, must-revalidate';

/** Make a response uncacheable by every layer: browser, CDN, and Vercel's edge. */
function sealFromSharedCaches(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', NO_STORE);
  response.headers.set('CDN-Cache-Control', NO_STORE);
  response.headers.set('Vercel-CDN-Cache-Control', NO_STORE);

  // Belt and braces for a cache that stores it anyway: make the cookie part of
  // the key, so one visitor's copy is not served to another. Next replaces Vary
  // on rendered pages with its own RSC list, so this lands on redirects and
  // route handlers; on a page it is the Cache-Control above that does the work.
  const vary = response.headers.get('Vary');
  response.headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');

  return response;
}

/** Supabase names its auth cookies `sb-<project-ref>-auth-token`, plus chunks. */
function carriesSupabaseSession(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase configured there is no session to check; let everything
  // through rather than locking the developer out of their own app.
  if (!url || !anonKey || url.includes('placeholder')) return response;

  // Set by Supabase's setAll below, i.e. exactly when this response is about to
  // hand the browser a rotated token.
  let wroteSessionCookies = false;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        wroteSessionCookies = true;
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

  /**
   * A redirect is itself a session-dependent answer — "you may not be here" or
   * "you are already signed in" — so it is never cacheable either, and it has to
   * carry any token Supabase just rotated. Dropping those cookies here is what
   * makes a freshly refreshed session evaporate on the very next hop.
   */
  const sendRedirect = (target: ReturnType<typeof request.nextUrl.clone>) => {
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));

    return sealFromSharedCaches(redirect);
  };

  if (!user && PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/auth';
    // Preserved through the whole round trip, including OAuth, so a user who
    // was deep-linked to a report lands back on it.
    redirect.searchParams.set('next', path + request.nextUrl.search);
    return sendRedirect(redirect);
  }

  if (user && AUTH_ROUTES.includes(path)) {
    const next = request.nextUrl.searchParams.get('next');
    const redirect = request.nextUrl.clone();
    redirect.pathname = next && next.startsWith('/') ? next.split('?')[0] : '/dashboard';
    redirect.search = '';
    return sendRedirect(redirect);
  }

  /**
   * Seal the response when it carries a session or when the session decides what
   * comes back. A signed-out visitor on a marketing page hits none of these and
   * keeps a fully cacheable, CDN-friendly response.
   */
  const dependsOnSession =
    wroteSessionCookies ||
    Boolean(user) ||
    carriesSupabaseSession(request) ||
    path.startsWith('/api/') ||
    AUTH_ROUTES.includes(path) ||
    PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  return dependsOnSession ? sealFromSharedCaches(response) : response;
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
