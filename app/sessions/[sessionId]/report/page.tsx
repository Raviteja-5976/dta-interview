/**
 * /sessions/[sessionId]/report — the report (sitemap-workflow.md §11).
 *
 * The product. Everything else exists to produce this page.
 *
 * Two framing rules that are not cosmetic:
 *   · Goal outcomes lead. They tell the candidate what the interview was TRYING
 *     to find out and whether it succeeded — the real answer to "how did I do",
 *     and something a score alone cannot say.
 *   · Fluency is presented as coaching, not competence, and stays out of the
 *     headline number (agentdesign.md §9.4). The speech panel is labelled
 *     accordingly, and accent is never mentioned because it is never scored.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Check, X } from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  ScoreBar,
  SectionTitle,
  Skeleton,
} from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

interface ReportShape {
  summary?: string;
  readiness_band?: string;
  goal_outcomes?: Array<{
    goal_id: string;
    statement: string;
    established: boolean;
    questions_asked: number;
    evidence_verified: number;
    evidence_total: number;
    verdict: string;
  }>;
  strengths?: Array<{ point: string; evidence_question_seq: number }>;
  weaknesses?: Array<{ point: string; why_it_matters: string; evidence_question_seq: number }>;
  improvement_plan?: Array<{
    rank: number;
    action: string;
    effort: string;
    success_check: string;
    addresses: string[];
  }>;
  speech_note?: string;
  next_interview_suggestion?: { focus_areas: string[]; recommended_difficulty: string };
}

interface Scores {
  overall: number;
  accuracy: number | null;
  depth: number | null;
  behavioral: number | null;
  coding: number | null;
  fluency: number | null;
}

interface SpeechSummary {
  wpm: number | null;
  filler_rate: number | null;
  long_pauses_per_min: number | null;
  note: string;
  trend?: string;
  excluded_questions?: number[];
}

interface SessionRow {
  id: string;
  seq: number;
  project_id: string;
  duration_sec: number | null;
  created_at: string;
  config: { modules?: { coding?: boolean; system_design?: boolean }; difficulty?: string } | null;
  scores: Scores | null;
  report: ReportShape | null;
  speech_summary: SpeechSummary | null;
}

export default function ReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [project, setProject] = useState<{ company_name: string; role_title: string; id: string } | null>(null);
  const [previous, setPrevious] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // db-design.md §6 "Interview Report page" — one row, named columns.
      const { data } = await supabase
        .from('sessions')
        .select('id, seq, project_id, duration_sec, created_at, config, scores, report, speech_summary')
        .eq('id', sessionId)
        .maybeSingle();

      setSession(data as SessionRow | null);

      if (data) {
        const [{ data: proj }, { data: prev }] = await Promise.all([
          supabase
            .from('projects')
            .select('id, company_name, role_title')
            .eq('id', data.project_id)
            .maybeSingle(),
          supabase
            .from('sessions')
            .select('overall_score')
            .eq('project_id', data.project_id)
            .eq('status', 'complete')
            .lt('seq', data.seq)
            .order('seq', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        setProject(proj as { company_name: string; role_title: string; id: string } | null);
        setPrevious(prev?.overall_score ?? null);
      }

      setLoading(false);
    })();
  }, [sessionId]);

  if (loading) {
    return (
      <Page>
        <Skeleton className="h-40 mb-6" />
        <Skeleton className="h-96" />
      </Page>
    );
  }

  if (!session?.report || !session.scores) {
    return (
      <Page>
        <EmptyState
          heading="This report isn't ready."
          body="The interview may still be being evaluated, or it did not complete."
          action={<Button href={`/sessions/${sessionId}/processing`}>Check progress</Button>}
        />
      </Page>
    );
  }

  const { report, scores, speech_summary: speech } = session;
  const delta = previous != null ? scores.overall - previous : null;

  return (
    <Page>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <Eyebrow>Interview {session.seq} · report</Eyebrow>
          <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B] mt-1">
            {project?.role_title} at {project?.company_name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Chip>{new Date(session.created_at).toLocaleDateString()}</Chip>
            {session.duration_sec && <Chip>{Math.round(session.duration_sec / 60)} min</Chip>}
            {session.config?.difficulty && <Chip>{session.config.difficulty}</Chip>}
            {session.config?.modules?.coding && <Chip accent="sky">Coding</Chip>}
            {session.config?.modules?.system_design && <Chip accent="yellow">System design</Chip>}
          </div>
        </div>
      </div>

      {/* Overall */}
      <Card className="p-6 md:p-8 mb-6">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="text-center md:text-left shrink-0">
            <Eyebrow>Overall</Eyebrow>
            <p className="font-[family-name:var(--font-display)] text-7xl font-extrabold tabular-nums text-[#1B1F3B] leading-none mt-2">
              {scores.overall.toFixed(1)}
            </p>
            {report.readiness_band && (
              <div className="mt-3">
                <Chip accent="yellow">{report.readiness_band}</Chip>
              </div>
            )}
            {delta !== null && Math.abs(delta) >= 0.1 && (
              <p
                className={`mt-3 font-[family-name:var(--font-mono)] text-sm font-bold ${
                  delta > 0 ? 'text-[#0d9488]' : 'text-[#FF5C7A]'
                }`}
              >
                {delta > 0 ? '+' : ''}
                {delta.toFixed(1)} since your last interview
              </p>
            )}
          </div>

          <div className="flex-1 space-y-3">
            <ScoreBar label="Technical accuracy" score={scores.accuracy} />
            <ScoreBar label="Depth of experience" score={scores.depth} />
            <ScoreBar label="Behavioral" score={scores.behavioral} />
            {scores.coding != null && <ScoreBar label="Coding" score={scores.coding} />}
          </div>
        </div>
      </Card>

      {/* Summary */}
      {report.summary && (
        <Card className="p-6 md:p-8 mb-6">
          <SectionTitle>How it went</SectionTitle>
          <p className="text-[#1B1F3B] leading-relaxed">{report.summary}</p>
        </Card>
      )}

      {/* Goal outcomes — the block worth leading with */}
      {report.goal_outcomes && report.goal_outcomes.length > 0 && (
        <Card className="p-6 md:p-8 mb-6">
          <SectionTitle sub="What this interview set out to establish, and whether it managed to.">
            What we were trying to find out
          </SectionTitle>

          <div className="space-y-4">
            {report.goal_outcomes.map((goal) => (
              <div
                key={goal.goal_id}
                className={`p-4 border-2 border-[#1B1F3B] rounded-2xl ${
                  goal.established ? 'bg-[#6EE7B7]/15' : 'bg-[#F5EBE0]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`w-6 h-6 shrink-0 mt-0.5 rounded-full border-2 border-[#1B1F3B] flex items-center justify-center ${
                      goal.established ? 'bg-[#6EE7B7]' : 'bg-white'
                    }`}
                  >
                    {goal.established ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  </span>

                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-display)] font-bold text-sm text-[#1B1F3B]">
                      {goal.statement}
                    </p>
                    <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 mt-1">
                      {goal.questions_asked} question{goal.questions_asked === 1 ? '' : 's'} ·{' '}
                      {goal.evidence_verified} of {goal.evidence_total} evidence items verified
                    </p>
                    <p className="text-sm text-[#1B1F3B]/85 mt-2">{goal.verdict}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Strengths / weaknesses */}
      <div className="grid md:grid-cols-2 gap-5 mb-6">
        <Card className="p-6" accent="mint">
          <SectionTitle>What went well</SectionTitle>
          <ul className="space-y-3">
            {(report.strengths ?? []).map((s, i) => (
              <li key={i} className="text-sm">
                <Link
                  href={`/sessions/${sessionId}/report/questions?q=${s.evidence_question_seq}`}
                  className="hover:underline"
                >
                  {s.point}
                  <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50 ml-1.5">
                    Q{s.evidence_question_seq} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6" accent="coral">
          <SectionTitle>What to work on</SectionTitle>
          <ul className="space-y-3">
            {(report.weaknesses ?? []).map((w, i) => (
              <li key={i} className="text-sm">
                <Link
                  href={`/sessions/${sessionId}/report/questions?q=${w.evidence_question_seq}`}
                  className="font-bold hover:underline"
                >
                  {w.point}
                  <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50 ml-1.5">
                    Q{w.evidence_question_seq} →
                  </span>
                </Link>
                <p className="text-[#1B1F3B]/70 mt-0.5">{w.why_it_matters}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Delivery — coaching, explicitly not competence */}
      {speech && (
        <Card className="p-6 md:p-8 mb-6">
          <SectionTitle sub="Coaching signals, reported separately from whether you knew the material.">
            How you sounded
          </SectionTitle>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <Readout label="Pace" value={speech.wpm != null ? `${Math.round(speech.wpm)}` : '—'} unit="WPM" />
            <Readout
              label="Fillers"
              value={speech.filler_rate != null ? `${(speech.filler_rate * 100).toFixed(1)}` : '—'}
              unit="%"
            />
            <Readout
              label="Long pauses"
              value={speech.long_pauses_per_min != null ? speech.long_pauses_per_min.toFixed(1) : '—'}
              unit="per min"
            />
          </div>

          {speech.trend && (
            <p className="text-sm text-[#1B1F3B]/85 p-3 bg-[#FFC93C]/20 border-2 border-[#1B1F3B] rounded-2xl">
              {speech.trend}
            </p>
          )}
          {report.speech_note && <p className="text-sm text-[#1B1F3B]/85 mt-3">{report.speech_note}</p>}

          <p className="mt-4 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 border-t-2 border-[#1B1F3B]/15 pt-3">
            {speech.note}
          </p>
        </Card>
      )}

      {/* Action plan */}
      {report.improvement_plan && report.improvement_plan.length > 0 && (
        <Card className="p-6 md:p-8 mb-6">
          <SectionTitle>What to do next</SectionTitle>
          <div className="space-y-4">
            {report.improvement_plan
              .sort((a, b) => a.rank - b.rank)
              .map((item) => (
                <div key={item.rank} className="flex gap-4 p-4 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-2xl">
                  <span className="w-8 h-8 shrink-0 bg-[#FF6B35] text-white border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center font-[family-name:var(--font-display)] font-extrabold text-sm">
                    {item.rank}
                  </span>
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-display)] font-bold text-sm">{item.action}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Chip>{item.effort}</Chip>
                      {item.addresses.map((a) => (
                        <Chip key={a} accent="sky">
                          {a}
                        </Chip>
                      ))}
                    </div>
                    <p className="text-sm text-[#1B1F3B]/70 mt-2">
                      <strong>You&apos;ll know it worked when:</strong> {item.success_check}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Sub-pages */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Button variant="secondary" href={`/sessions/${sessionId}/report/questions`}>
          Question-by-question review <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      {/* The loop — make it the last thing on the page */}
      <Card className="p-6 md:p-8 text-center" accent="orange">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold mb-2">
          Practise these areas
        </h2>
        <p className="text-sm text-[#1B1F3B]/70 mb-5">
          Your setup is already done — the next interview takes seconds to start.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Button
            href={`/projects/${session.project_id}/interview/new?focus=${encodeURIComponent(
              (report.next_interview_suggestion?.focus_areas ?? []).join(','),
            )}`}
          >
            Start a targeted interview <ArrowRight className="w-4 h-4" />
          </Button>
          <Button variant="secondary" href={`/projects/${session.project_id}/gaps`}>
            See all your gaps
          </Button>
        </div>
      </Card>
    </Page>
  );
}

function Readout({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-2xl p-3 text-center">
      <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/60">
        {label}
      </p>
      <p className="font-[family-name:var(--font-display)] text-2xl font-extrabold tabular-nums text-[#1B1F3B]">
        {value}
      </p>
      <p className="font-[family-name:var(--font-mono)] text-[10px] text-[#1B1F3B]/50">{unit}</p>
    </div>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <AppHeader />
      <main className="max-w-[900px] mx-auto px-4 md:px-8 py-8">{children}</main>
    </div>
  );
}
