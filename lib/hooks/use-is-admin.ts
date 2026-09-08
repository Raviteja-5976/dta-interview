/**
 * Whether the signed-in user is staff, for showing the Admin link in the header.
 *
 * Presentation only. Nothing is protected by this: the console gates itself in
 * `app/admin/layout.tsx` and every `/api/admin/*` handler re-checks, so the worst
 * a tampered-with client can do is render a link to a page that 404s at it.
 *
 * `false` until proven otherwise, so the link never flashes into view and back
 * out again on a normal page load.
 */

'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/db';

export function useIsAdmin(override?: 'student' | 'admin' | null): boolean {
  const { user } = useAuth();
  const userId = user?.id;
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    // Pages that already hold a profile hand the role over; no need to re-read it.
    if (override != null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdmin(override === 'admin');
      return;
    }

    if (!userId || !isSupabaseConfigured()) {
      setAdmin(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      if (!cancelled) setAdmin((data as { role?: string } | null)?.role === 'admin');
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, override]);

  return admin;
}
