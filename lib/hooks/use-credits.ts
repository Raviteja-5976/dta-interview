/**
 * The signed-in user's credit balance, live.
 *
 * The header sits on every app screen but almost none of them fetch a profile —
 * they fetch a project, a session, a report. So the pill read a hardcoded
 * fallback and told everyone they had 4 credits regardless of the truth. A
 * number that is wrong is worse than no number: this is the balance someone
 * checks before spending it.
 *
 * So the header owns its own read. One column, one row, and a realtime
 * subscription on that row — a balance changes while the page is open (an
 * interview bills per minute as it runs, a purchase lands from Stripe), and a
 * stale figure sends someone into an interview they cannot afford.
 *
 * `null` means "not known yet" and must render as a skeleton, never as a
 * number. There is no sensible default to fall back to.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/db';

export interface CreditsState {
  /** `null` until the balance is known — render a skeleton, not a zero. */
  credits: number | null;
  loading: boolean;
  /** Re-read after something that spends or grants credits. */
  refresh: () => Promise<void>;
}

export function useCredits(override?: number | null): CreditsState {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;

  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      setCredits(null);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('profiles')
      .select('credits_balance')
      .eq('id', userId)
      .maybeSingle();

    setCredits((data as { credits_balance: number } | null)?.credits_balance ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (override != null) return;
    // A fetch on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, override]);

  // Realtime, so the pill drains as an interview bills and tops up the moment a
  // purchase clears — without the user reloading to find out.
  useEffect(() => {
    if (override != null || !userId || !isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`profile-credits:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const next = (payload.new as { credits_balance?: number } | null)?.credits_balance;
          if (typeof next === 'number') setCredits(next);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, override]);

  if (override != null) {
    return { credits: override, loading: false, refresh: load };
  }

  return {
    credits,
    // Signed out is a settled answer, not a pending one.
    loading: userId ? loading : authLoading,
    refresh: load,
  };
}
