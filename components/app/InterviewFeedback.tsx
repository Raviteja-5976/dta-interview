/**
 * The feedback card at the bottom of a report.
 *
 * Placement is deliberate: after the report, never between the interview and it.
 * A survey standing in front of the result someone just paid for gets answered
 * by people trying to make it go away, and the answers are worthless.
 *
 * Two questions, and only the first is required. Every field past that roughly
 * halves completion, and the app already knows what happened in the interview —
 * scores, duration, per-question metrics. The only thing it cannot know is how
 * it felt, which is what this asks.
 *
 * Writes go through the browser client under RLS: `session_feedback_own`
 * (migration 020) checks both that the row is theirs and that the session is,
 * so no route handler is needed to make this safe.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Star } from 'lucide-react';

import { Button, Card } from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

type Phase = 'loading' | 'form' | 'saving' | 'done';

export default function InterviewFeedback({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [rating, setRating] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [improvement, setImprovement] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Already answered? Show it back rather than asking twice — someone who
  // revisits a report should not be nagged for feedback they already gave.
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('session_feedback')
      .select('rating, would_recommend, improvement')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (data) {
      const row = data as { rating: number; would_recommend: boolean | null; improvement: string | null };
      setRating(row.rating);
      setRecommend(row.would_recommend);
      setImprovement(row.improvement ?? '');
      setPhase('done');
    } else {
      setPhase('form');
    }
  }, [sessionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const submit = async () => {
    if (rating == null) return;
    setPhase('saving');
    setError(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError('Your session expired. Sign in again and it will save.');
      setPhase('form');
      return;
    }

    // Upsert on session_id: the table's unique constraint turns a second
    // submission into an edit of the first rather than a duplicate row.
    const { error: writeError } = await supabase.from('session_feedback').upsert(
      {
        session_id: sessionId,
        user_id: auth.user.id,
        rating,
        would_recommend: recommend,
        improvement: improvement.trim() || null,
      },
      { onConflict: 'session_id' },
    );

    if (writeError) {
      setError('That did not save. Try once more?');
      setPhase('form');
      return;
    }

    setPhase('done');
  };

  if (phase === 'loading') return null;

  if (phase === 'done') {
    return (
      <Card className="p-6 mb-6" accent="mint">
        <div className="flex items-start gap-3">
          <Check className="w-6 h-6 shrink-0 text-[#1B1F3B]" />
          <div>
            <p className="font-[family-name:var(--font-display)] font-extrabold text-[#1B1F3B]">
              Thanks — that helps more than you think.
            </p>
            <p className="text-sm text-[#1B1F3B]/70 mt-0.5">
              You rated this interview {rating}/5.{' '}
              <button
                onClick={() => setPhase('form')}
                className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline"
              >
                Change it
              </button>
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const busy = phase === 'saving';
  const shown = hovered ?? rating ?? 0;

  return (
    <Card className="p-6 md:p-8 mb-6">
      <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold text-[#1B1F3B]">
        How was that interview?
      </h2>
      <p className="text-sm text-[#1B1F3B]/70 mt-1 mb-5">
        We read every one of these. It is how the interviewer gets better.
      </p>

      {/* Rating — the only required field */}
      <div className="flex items-center gap-1 mb-6" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            onClick={() => setRating(i)}
            onMouseEnter={() => setHovered(i)}
            disabled={busy}
            aria-label={`${i} out of 5`}
            className="p-1 transition-transform hover:scale-110 disabled:pointer-events-none"
          >
            <Star
              className={`w-9 h-9 transition-colors ${
                i <= shown
                  ? 'text-[#FFC93C] fill-[#FFC93C] stroke-[#1B1F3B] stroke-[1.5]'
                  : 'text-[#1B1F3B]/20'
              }`}
            />
          </button>
        ))}
      </div>

      {/* Everything below appears only once they have rated — asking for prose
          before the one-click question is answered is how you get neither. */}
      {rating != null && (
        <>
          <label className="block font-[family-name:var(--font-display)] text-sm font-bold text-[#1B1F3B] mb-2">
            What would you change?{' '}
            <span className="font-normal text-[#1B1F3B]/50">Optional</span>
          </label>
          <textarea
            value={improvement}
            onChange={(e) => setImprovement(e.target.value)}
            disabled={busy}
            rows={3}
            maxLength={2000}
            placeholder="The questions felt too easy for the role… / the voice cut out when I paused…"
            className="w-full px-4 py-3 bg-white border-4 border-[#1B1F3B] rounded-2xl shadow-[3px_3px_0_#1B1F3B] text-sm resize-y focus:outline-none focus:shadow-[5px_5px_0_#FF6B35]"
          />

          <div className="flex flex-wrap items-center gap-3 mt-5">
            <span className="font-[family-name:var(--font-display)] text-sm font-bold text-[#1B1F3B]">
              Would you recommend this to a friend?
            </span>
            <div className="flex gap-2">
              <Toggle active={recommend === true} onClick={() => setRecommend(recommend === true ? null : true)}>
                Yes
              </Toggle>
              <Toggle active={recommend === false} onClick={() => setRecommend(recommend === false ? null : false)}>
                No
              </Toggle>
            </div>
          </div>

          {error && (
            <p className="mt-4 font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF5C7A]">{error}</p>
          )}

          <div className="mt-6">
            <Button onClick={() => void submit()} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? 'Sending…' : 'Send feedback'}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function Toggle({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full border-2 border-[#1B1F3B] font-[family-name:var(--font-display)] text-sm font-bold transition-all ${
        active ? 'bg-[#1B1F3B] text-white' : 'bg-white text-[#1B1F3B] hover:bg-[#F5EBE0]'
      }`}
    >
      {children}
    </button>
  );
}
