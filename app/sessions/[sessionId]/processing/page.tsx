/**
 * /sessions/[sessionId]/processing — evaluation in progress (sitemap §10).
 *
 * A route, not a modal, because evaluation takes 1-3 minutes and people close
 * the tab. Reachable at any time; if the session is already complete it
 * redirects straight to the report.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Button, Card, ErrorCard, Eyebrow, StageList } from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

const STAGES = [
  'Assembling your transcript',
  'Measuring how you spoke',
  'Checking your answers',
  'Writing your report',
];

export default function ProcessingPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refunded, setRefunded] = useState(0);
  const evaluateFired = useRef(false);

  const check = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, status, credits_charged')
      .eq('id', sessionId)
      .maybeSingle();

    if (!data) {
      setError('We could not find that interview.');
      return;
    }

    if (data.status === 'complete') {
      router.replace(`/sessions/${sessionId}/report`);
      return;
    }

    if (data.status === 'failed') {
      setError('Something went wrong while writing your report.');
      setRefunded(data.credits_charged ?? 0);
      return;
    }

    if (!evaluateFired.current && data.status === 'processing') {
      evaluateFired.current = true;
      // Advance the stage list optimistically so the page reads as alive; the
      // realtime subscription below is what actually moves it on.
      const ticker = setInterval(() => setStage((s) => Math.min(STAGES.length - 1, s + 1)), 25_000);

      const res = await fetch(`/api/sessions/${sessionId}/evaluate`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      clearInterval(ticker);

      if (body.status === 'complete') {
        router.replace(`/sessions/${sessionId}/report`);
      } else {
        setError(body.error ?? 'Something went wrong while writing your report.');
        setRefunded(body.refunded ?? 0);
      }
    }
  }, [sessionId, router]);

  useEffect(() => {
    // Loading from Supabase on mount, not deriving state from props. The lint
    // rule cannot distinguish the two; every setState here happens inside an
    // async continuation, after the effect body has already returned.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
  }, [check]);

  // Realtime on the session row — the Processing screen should not poll (§8).
  useEffect(() => {
    const channel = supabase
      .channel(`session:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        ({ new: row }) => {
          const status = (row as { status: string }).status;
          if (status === 'complete') router.replace(`/sessions/${sessionId}/report`);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, router]);

  return (
    <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {error ? (
          <ErrorCard
            heading="We couldn't finish your report"
            body={
              refunded > 0
                ? `${error} We've put your ${refunded} credit${refunded === 1 ? '' : 's'} back — you were not charged for this.`
                : `${error} You were not charged for this.`
            }
            action={
              <div className="flex flex-wrap gap-3">
                <Button href="/dashboard">Back to dashboard</Button>
                <Button variant="ghost" href="mailto:support@devtrackacademy.com">
                  Contact support
                </Button>
              </div>
            }
          />
        ) : (
          <Card className="p-8">
            <Eyebrow>Interview complete</Eyebrow>
            <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-extrabold mt-2 mb-6">
              Writing your report
            </h1>

            <StageList stages={STAGES} current={stage} />

            <div className="mt-8 pt-6 border-t-2 border-[#1B1F3B]/15">
              <p className="font-[family-name:var(--font-display)] font-bold text-sm">About two minutes.</p>
              <p className="text-sm text-[#1B1F3B]/70 mt-1">
                We&apos;ll email you when it&apos;s ready — you can close this page.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
