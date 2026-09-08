/**
 * /admin/feedback — what people said about the interview, one at a time.
 *
 * Read as a list of cards rather than a table, because the useful part is the
 * sentence someone typed, and a table column truncates it into uselessness. The
 * rating is there to sort your attention, not to be averaged into a number that
 * hides the two people who had a bad time.
 *
 * Every card links to the report it is about, so "this felt too easy" can be
 * checked against what the interview actually asked.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Star } from 'lucide-react';

import { Button, Card, Chip, EmptyState, ErrorCard, Skeleton } from '@/components/app/ui';

interface FeedbackRow {
  id: string;
  session_id: string;
  user_id: string;
  rating: number;
  would_recommend: boolean | null;
  improvement: string | null;
  created_at: string;
  profiles: { email: string | null; full_name: string | null } | null;
  sessions: {
    seq: number;
    duration_sec: number | null;
    overall_score: number | null;
    project_id: string;
  } | null;
}

const PAGE_SIZE = 25;

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (rating) params.set('rating', String(rating));

      const res = await fetch(`/api/admin/feedback?${params}`);
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? 'Could not load feedback.');
        return;
      }
      setRows(body.feedback);
      setTotal(body.total);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [offset, rating]);

  useEffect(() => {
    // A fetch on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <>
      {/* Rating filter. "1-2 stars" is the one that gets clicked, so it is its own chip. */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <FilterChip active={rating === null} onClick={() => { setRating(null); setOffset(0); }}>
          All
        </FilterChip>
        {[5, 4, 3, 2, 1].map((r) => (
          <FilterChip key={r} active={rating === r} onClick={() => { setRating(r); setOffset(0); }}>
            {r}★
          </FilterChip>
        ))}
        <span className="ml-auto font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/60 tabular-nums">
          {total} {total === 1 ? 'response' : 'responses'}
        </span>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorCard
            heading="Could not load feedback"
            body={error}
            action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}
          />
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          heading={rating ? `No ${rating}-star responses.` : 'No feedback yet.'}
          body={
            rating
              ? 'Try another rating, or clear the filter.'
              : 'The card appears at the bottom of every report — responses will land here as people finish interviews.'
          }
          action={
            rating ? (
              <Button variant="secondary" onClick={() => setRating(null)}>Show all</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id} className="p-5 md:p-6" accent={row.rating <= 2 ? 'coral' : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Stars rating={row.rating} />
                    {row.would_recommend === true && <Chip accent="mint">Would recommend</Chip>}
                    {row.would_recommend === false && <Chip accent="coral">Would not recommend</Chip>}
                  </div>
                  <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 mt-2 truncate">
                    {row.profiles?.full_name ? `${row.profiles.full_name} · ` : ''}
                    {row.profiles?.email ?? row.user_id}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55">
                    {new Date(row.created_at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {row.sessions && (
                    <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55 tabular-nums mt-0.5">
                      Interview {row.sessions.seq}
                      {row.sessions.overall_score != null && ` · scored ${row.sessions.overall_score}`}
                      {row.sessions.duration_sec != null &&
                        ` · ${Math.round(row.sessions.duration_sec / 60)} min`}
                    </p>
                  )}
                </div>
              </div>

              {row.improvement ? (
                <blockquote className="border-l-4 border-[#1B1F3B] pl-4 py-1 text-[#1B1F3B] leading-relaxed whitespace-pre-wrap">
                  {row.improvement}
                </blockquote>
              ) : (
                <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/40 italic">
                  Rating only — they did not write anything.
                </p>
              )}

              <div className="mt-4">
                <Link
                  href={`/sessions/${row.session_id}/report`}
                  className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline"
                >
                  Open the report this is about →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {loading && rows.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-4 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 mt-6">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ← Newer
          </Button>
          <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 tabular-nums">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Older →
          </Button>
        </div>
      )}
    </>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${
            i <= rating ? 'text-[#FFC93C] fill-[#FFC93C]' : 'text-[#1B1F3B]/20'
          }`}
        />
      ))}
    </span>
  );
}

function FilterChip({
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
      className={`px-3.5 py-1.5 rounded-full border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider transition-all ${
        active ? 'bg-[#1B1F3B] text-white' : 'bg-white text-[#1B1F3B] hover:bg-[#F5EBE0]'
      }`}
    >
      {children}
    </button>
  );
}
