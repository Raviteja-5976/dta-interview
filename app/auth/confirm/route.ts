/**
 * GET /auth/confirm — where every link in an email lands.
 *
 * Signup confirmation, magic links and password recovery all arrive here. It
 * handles BOTH shapes Supabase can send, because which one you get depends on
 * how the project's email templates are written:
 *
 *   ?token_hash=…&type=…   the `{{ .TokenHash }}` templates. Works across
 *                          devices — sign up on a laptop, open the mail on your
 *                          phone, and it still verifies.
 *
 *   ?code=…                the default `{{ .ConfirmationURL }}` template, via
 *                          PKCE. Needs the SAME browser that started the flow,
 *                          because the code verifier lives in its storage.
 *
 * Supporting both means this works on a fresh Supabase project with no template
 * editing, and gets better the moment the templates are switched to TokenHash
 * (see the setup note at the bottom of this file).
 *
 * OAuth keeps its own route at /auth/callback. Same idea, different entry point,
 * and merging them would make one handler answer to two unrelated flows.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Anything else in `type` is not something we asked Supabase to send. */
const ALLOWED_TYPES: EmailOtpType[] = ['signup', 'magiclink', 'recovery', 'invite', 'email', 'email_change'];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const tokenHash = searchParams.get('token_hash');
  const code = searchParams.get('code');
  const rawType = searchParams.get('type');
  const rawNext = searchParams.get('next');

  // Relative paths only. An absolute URL here would be an open redirect, and
  // this endpoint is reachable by anyone who can craft a link.
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  const fail = (message: string) =>
    NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent(message)}`);

  const supabase = await createSupabaseServerClient();

  if (tokenHash) {
    const type = (rawType && ALLOWED_TYPES.includes(rawType as EmailOtpType)
      ? rawType
      : 'email') as EmailOtpType;

    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (error) {
      return fail(
        type === 'recovery'
          ? 'That password reset link has expired. Request a new one.'
          : 'That confirmation link has expired. Sign in to get a new one.',
      );
    }

    return NextResponse.redirect(`${origin}${next}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // The overwhelmingly common cause is opening the link on a different
      // device from the one that started the flow — PKCE cannot work across
      // devices, and "expired" would send someone hunting for the wrong problem.
      return fail(
        'That link could not be opened here. Open it in the same browser you signed up in, or request a new one.',
      );
    }

    return NextResponse.redirect(`${origin}${next}`);
  }

  return fail('That link is incomplete. Request a new one.');
}

/*
 * ── Supabase setup ──────────────────────────────────────────────────────────
 *
 * Authentication → URL Configuration → Redirect URLs must allow:
 *
 *   http://localhost:3000/auth/**
 *   https://<your-production-domain>/auth/**
 *
 * Without those, Supabase silently rewrites the redirect to the Site URL and the
 * link appears to work while dropping the `next` you asked for.
 *
 * Optional but recommended — Authentication → Email Templates. Rewriting
 * "Confirm signup" and "Reset password" to the TokenHash form makes the links
 * work across devices, which is the difference between a student signing up on
 * a laptop and reading the mail on their phone succeeding or failing:
 *
 *   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard">
 *     Confirm your email
 *   </a>
 *
 *   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password">
 *     Reset your password
 *   </a>
 *
 * Leaving the templates alone is fine too — the `code` branch above covers it.
 */
