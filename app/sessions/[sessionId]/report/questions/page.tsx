/**
 * /sessions/[sessionId]/report/questions — question-by-question review (§11).
 *
 * Deep-linkable per question (`?q=7`) so report links from /gaps and from the
 * strengths and weaknesses lists land on the right card.
 *
 * The two-tab pair defaults to "Better version of what you said" rather than
 * "Ideal answer" — the improved one is the one people can act on.
 */

'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronDown } from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import { Button, Card, Chip, EmptyState, Eyebrow, Skeleton } from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

interface QuestionRow {
  seq: number;
  question: {
    text: string;
    goal_id?: string;
    difficulty?: number;
    partially_heard?: boolean;
  };
  answer: { transcript: string } | null;
  metrics: {
    wpm_articulation: number | null;
    filler_rate: number;
    reliability: 'ok' | 'low';
    reliability_reason?: string;
  } | null;
  grading: {
    concept_coverage?: Array<{
      signal_id: string;
      status: 'covered' | 'partial' | 'missing';
      quoted_span: string;
    }>;
    incorrect_claims?: Array<{ claim: string; correction: string; severity: string }>;
    one_thing_to_change?: string;
    observations?: string[];
  } | null;
  rewrite: { improved: string; ideal: string; one_change: string } | null;
  /**
   * SV's review of a skill-challenge submission. Null on every other question.
   *
   * It is the only place the candidate ever finds out what the reader made of
   * the code they wrote — nothing about it is shown during the interview, by
   * design, so this page is where the round pays off.
   */
  skill_review: {
    requirements_met?: Array<{ id: string; met: 'yes' | 'partial' | 'no'; evidence: string; note: string }>;
    defects?: Array<{ severity: 'major' | 'minor'; what: string; where: string }>;
    strengths?: string[];
    bug_found?: 'yes' | 'partial' | 'no' | 'not_applicable';
    summary?: string;
    verdict?: 'strong' | 'acceptable' | 'weak' | 'incorrect';
  } | null;
  scores: { primary: number } | null;
  accuracy: number | null;
  fluency: number | null;
  grading_mode: string;
  skill_tags: string[];
}

/** `?q=7` deep links are read with useSearchParams, which needs Suspense. */
export default function QuestionReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FFF8F0]">
          <AppHeader />
          <main className="max-w-[900px] mx-auto px-4 md:px-8 py-8">
            <Skeleton className="h-96" />
          </main>
        </div>
      }
    >
      <QuestionReviewContent />
    </Suspense>
  );
}

function QuestionReviewContent() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const focusSeq = Number(search.get('q')) || null;

  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(focusSeq);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('session_questions')
        .select(
          'seq, question, answer, metrics, grading, rewrite, skill_review, scores, accuracy, fluency, grading_mode, skill_tags',
        )
        .eq('session_id', sessionId)
        .order('seq');

      setRows((data as QuestionRow[]) ?? []);
      setLoading(false);
    })();
  }, [sessionId]);

  // Scroll the deep-linked card into view once it exists in the DOM.
  useEffect(() => {
    if (!focusSeq || loading) return;
    document.getElementById(`q-${focusSeq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusSeq, loading]);

  const content = useMemo(() => {
    if (loading) return <Skeleton className="h-96" />;

    if (rows.length === 0) {
      return (
        <EmptyState
          heading="No questions to review."
          body="This interview did not record any graded answers."
          action={<Button href={`/sessions/${sessionId}/report`}>Back to the report</Button>}
        />
      );
    }

    return (
      <div className="space-y-4">
        {rows.map((row) => (
          <QuestionCard
            key={row.seq}
            row={row}
            open={open === row.seq}
            onToggle={() => setOpen(open === row.seq ? null : row.seq)}
          />
        ))}
      </div>
    );
  }, [loading, rows, open, sessionId]);

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <AppHeader />
      <main className="max-w-[900px] mx-auto px-4 md:px-8 py-8">
        <Link
          href={`/sessions/${sessionId}/report`}
          className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline"
        >
          ← Back to the report
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B] mt-3 mb-8">
          Every question, one at a time
        </h1>
        {content}
      </main>
    </div>
  );
}

function QuestionCard({
  row,
  open,
  onToggle,
}: {
  row: QuestionRow;
  open: boolean;
  onToggle: () => void;
}) {
  const [tab, setTab] = useState<'improved' | 'ideal'>('improved');

  const coverage = row.grading?.concept_coverage ?? [];
  const covered = coverage.filter((c) => c.status === 'covered').length;
  const score = row.scores?.primary ?? row.accuracy;

  return (
    <div id={`q-${row.seq}`}>
      <Card className="overflow-hidden">
        <button onClick={onToggle} className="w-full p-5 text-left hover:bg-[#F5EBE0] transition-colors">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Chip>Q{row.seq}</Chip>
                <Chip accent="sky">{row.grading_mode}</Chip>
                {/* Must be visible: this question was graded differently (§11). */}
                {row.question.partially_heard && (
                  <Chip accent="yellow">
                    <AlertTriangle className="w-3 h-3" /> Partially heard
                  </Chip>
                )}
                {row.metrics?.reliability === 'low' && (
                  <Chip accent="coral">Delivery not measured</Chip>
                )}
              </div>
              <p className="font-[family-name:var(--font-display)] font-bold text-[#1B1F3B]">
                {row.question.text}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <p className="font-[family-name:var(--font-display)] text-2xl font-extrabold tabular-nums">
                  {score != null ? score.toFixed(1) : '—'}
                </p>
                {coverage.length > 0 && (
                  <p className="font-[family-name:var(--font-mono)] text-[10px] text-[#1B1F3B]/60">
                    {covered}/{coverage.length} covered
                  </p>
                )}
              </div>
              <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </button>

        {open && (
          <div className="px-5 pb-5 border-t-2 border-[#1B1F3B]/15 pt-5 space-y-5">
            {/* Their answer */}
            <div>
              <Eyebrow>What you said</Eyebrow>
              <p className="mt-2 text-sm text-[#1B1F3B]/85 leading-relaxed p-3 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-2xl">
                {row.answer?.transcript ?? '(no transcript)'}
              </p>
            </div>

            {/* Evidence coverage — each row carries the span that earned it */}
            {coverage.length > 0 && (
              <div>
                <Eyebrow>What a strong answer covers</Eyebrow>
                <ul className="mt-2 space-y-2">
                  {coverage.map((c) => (
                    <li key={c.signal_id} className="flex gap-3 text-sm">
                      <span
                        className="shrink-0 w-5 h-5 rounded-full border-2 border-[#1B1F3B] flex items-center justify-center text-[10px] font-bold"
                        style={{
                          backgroundColor:
                            c.status === 'covered' ? '#6EE7B7' : c.status === 'partial' ? '#FFC93C' : '#FF5C7A',
                        }}
                      >
                        {c.status === 'covered' ? '✓' : c.status === 'partial' ? '~' : '✕'}
                      </span>
                      <div className="min-w-0">
                        <span className="font-medium text-[#1B1F3B]">{c.signal_id}</span>
                        {c.quoted_span && (
                          <p className="text-[#1B1F3B]/60 italic mt-0.5">&ldquo;{c.quoted_span}&rdquo;</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Corrections — only when non-empty */}
            {row.grading?.incorrect_claims && row.grading.incorrect_claims.length > 0 && (
              <div className="p-4 border-4 border-[#FF5C7A] rounded-2xl bg-[#FF5C7A]/10">
                <Eyebrow>What you got wrong</Eyebrow>
                <ul className="mt-2 space-y-3">
                  {row.grading.incorrect_claims.map((c, i) => (
                    <li key={i} className="text-sm">
                      <p className="line-through text-[#1B1F3B]/60">{c.claim}</p>
                      <p className="font-medium text-[#1B1F3B] mt-0.5">{c.correction}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* What the reader made of the code, on the skill round only. */}
            {row.skill_review && (
              <div className="p-4 border-4 border-[#1B1F3B] rounded-2xl bg-white space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>Review of what you wrote</Eyebrow>
                  {row.skill_review.verdict && (
                    <Chip
                      accent={
                        row.skill_review.verdict === 'strong'
                          ? 'mint'
                          : row.skill_review.verdict === 'acceptable'
                            ? 'yellow'
                            : 'coral'
                      }
                    >
                      {row.skill_review.verdict}
                    </Chip>
                  )}
                </div>

                {row.skill_review.summary && (
                  <p className="text-sm text-[#1B1F3B]/85 leading-relaxed">{row.skill_review.summary}</p>
                )}

                {/* Only meaningful on a debug task, where finding the fault WAS
                    the task — so it is not rendered when it does not apply. */}
                {row.skill_review.bug_found && row.skill_review.bug_found !== 'not_applicable' && (
                  <Chip accent={row.skill_review.bug_found === 'yes' ? 'mint' : 'coral'}>
                    {row.skill_review.bug_found === 'yes'
                      ? 'Found the bug'
                      : row.skill_review.bug_found === 'partial'
                        ? 'Partly found the bug'
                        : 'Did not find the bug'}
                  </Chip>
                )}

                {/* The requirements, and how each one landed. This is the mark
                    scheme, shown afterwards — during the round it is withheld,
                    because a visible checklist turns the task into a checklist. */}
                {row.skill_review.requirements_met && row.skill_review.requirements_met.length > 0 && (
                  <ul className="space-y-1.5">
                    {row.skill_review.requirements_met.map((r) => (
                      <li key={r.id} className="flex gap-2 text-sm">
                        <span
                          className="shrink-0 mt-1 w-3 h-3 rounded-full border-2 border-[#1B1F3B]"
                          style={{
                            backgroundColor:
                              r.met === 'yes' ? '#6EE7B7' : r.met === 'partial' ? '#FFC93C' : '#FF5C7A',
                          }}
                        />
                        <span className="text-[#1B1F3B]/85">{r.note}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {row.skill_review.defects && row.skill_review.defects.length > 0 && (
                  <div>
                    <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 mb-1">
                      What would bite you
                    </p>
                    <ul className="space-y-1">
                      {row.skill_review.defects.map((d, i) => (
                        <li key={i} className="text-sm text-[#1B1F3B]/85">
                          <span className="font-[family-name:var(--font-mono)] text-xs">{d.where}</span> —{' '}
                          {d.what}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Rewrites — improved is the default tab */}
            {row.rewrite && (
              <div>
                <div className="flex gap-2 mb-3">
                  <TabButton active={tab === 'improved'} onClick={() => setTab('improved')}>
                    Better version of what you said
                  </TabButton>
                  <TabButton active={tab === 'ideal'} onClick={() => setTab('ideal')}>
                    Ideal answer
                  </TabButton>
                </div>
                <p className="text-sm text-[#1B1F3B]/85 leading-relaxed p-3 bg-white border-2 border-[#1B1F3B] rounded-2xl">
                  {tab === 'improved' ? row.rewrite.improved : row.rewrite.ideal}
                </p>
              </div>
            )}

            {/* The single highest-leverage note */}
            {(row.rewrite?.one_change || row.grading?.one_thing_to_change) && (
              <div className="p-4 bg-[#FFC93C]/25 border-2 border-[#1B1F3B] rounded-2xl">
                <Eyebrow>One thing to change</Eyebrow>
                <p className="mt-1 text-sm font-medium text-[#1B1F3B]">
                  {row.rewrite?.one_change ?? row.grading?.one_thing_to_change}
                </p>
              </div>
            )}

            {/* Delivery readouts in the footer */}
            {row.metrics && row.metrics.reliability === 'ok' && (
              <div className="flex flex-wrap gap-2 pt-2 border-t-2 border-[#1B1F3B]/15">
                {row.metrics.wpm_articulation != null && (
                  <Chip>{Math.round(row.metrics.wpm_articulation)} WPM</Chip>
                )}
                <Chip>{(row.metrics.filler_rate * 100).toFixed(1)}% fillers</Chip>
                {row.skill_tags.map((t) => (
                  <Chip key={t} accent="sky">
                    {t}
                  </Chip>
                ))}
              </div>
            )}

            {row.metrics?.reliability === 'low' && (
              <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                Delivery not measured for this answer — {row.metrics.reliability_reason}. It is excluded
                from your speech averages.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function TabButton({
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
      className={`px-3 py-1.5 rounded-full border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wide transition-colors ${
        active ? 'bg-[#1B1F3B] text-white' : 'bg-white text-[#1B1F3B]'
      }`}
    >
      {children}
    </button>
  );
}
