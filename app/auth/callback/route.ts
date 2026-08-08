/**
 * GET /auth/callback — the OAuth handoff.
 *
 * sitemap-workflow.md §2: the `next` param is preserved through the whole OAuth
 * round trip, and the `profiles` row already exists by the time we get here
 * thanks to the `on_auth_user_created` trigger.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next');

  // Only relative paths. An absolute URL here would be an open redirect.
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent('Sign-in was cancelled.')}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent('That sign-in link has expired. Try again.')}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
