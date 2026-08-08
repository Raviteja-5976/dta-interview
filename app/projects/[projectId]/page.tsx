/**
 * /projects/[projectId] — Overview (sitemap-workflow.md §6).
 *
 * Everything important about this project on one screen. When `status` is
 * `preparing` the page renders its skeleton with a named stage strip and fills
 * in over realtime — the user is never held on a blocking spinner, and if they
 * close the tab prep continues regardless.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, RotateCw, Target } from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import ProjectHeader from '@/components/app/ProjectHeader';
import {
  Button,
  Card,
  EmptyState,
  ErrorCard,
  Eyebrow,
  ReadinessRing,
  ScoreBar,
  SectionTitle,
  Skeleton,
  SkillStatusChip,
  StageList,
  StatTile,
} from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

const PREP_STAGES = [
  'Reading your resume',
  'Reading the company site',
  'Comparing your resume to the role',
  'Planning the interview',
];

interface ProjectRow {
  id: string;
  company_name: string;
  company_logo_url: string | null;
  role_title: string;
  seniority: string | null;
  status: string;
  readiness: Record<string, number | undefined> & { history?: Array<{ overall: number }> };
  stats: Record<string, number | undefined>;
  prep_error: { stage?: string; message?: string; recoverable?: boolean } | null;
}

interface SkillRow {
  skill: string;
  status: string | null;
  score: number | null;
  jd_importance: number | null;
  sessions_seen: number;
}

interface SessionRow {
  id: string;
  seq: number;
  status: string;
  overall_score: number | null;
  created_at: string;
}

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const prepTriggered = useRef(false);

  const load = useCallback(async () => {
    // Only the columns this screen reads — the four AI artifact columns stay in
    // TOAST where they belong (db-design.md §6 "Project Overview tab").
    const { data } = await supabase
      .from('projects')
      .select('id, company_name, company_logo_url, role_title, seniority, status, readiness, stats, prep_error')
      .eq('id', projectId)
      .maybeSingle();

    setProject(data as ProjectRow | null);
    setLoading(false);

    if (data) {
      const [{ data: skillRows }, { data: sessionRows }] = await Promise.all([
        supabase
          .from('skill_progress')
          .select('skill, status, score, jd_importance, sessions_seen')
          .eq('project_id', projectId)
          .order('jd_importance', { ascending: false, nullsFirst: false })
          .limit(20),
        supabase
          .from('sessions')
          .select('id, seq, status, overall_score, created_at')
          .eq('project_id', projectId)
          .order('seq', { ascending: false })
          .limit(3),
      ]);

      setSkills((skillRows as SkillRow[]) ?? []);
      setSessions((sessionRows as SessionRow[]) ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    // Data loading on mount, not derived state — see the note in
    // sessions/[sessionId]/processing for why this is suppressed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Realtime: sections swap in as prep lands, rather than the user polling.
  useEffect(() => {
    const channel = supabase
      .channel(`project:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, load]);

  // Kick the prep pipeline once. There is no job queue yet, so the page that
  // lands first is what starts the work.
  const runPrep = useCallback(async () => {
    setRetrying(true);
    try {
      await fetch(`/api/projects/${projectId}/prep`, { method: 'POST' });
    } finally {
      setRetrying(false);
      void load();
    }
  }, [projectId, load]);

  useEffect(() => {
    if (!project || prepTriggered.current) return;
    if (project.status === 'preparing') {
      prepTriggered.current = true;
      // Fires the prep pipeline exactly once — an external side effect, guarded
      // by a ref so a re-render cannot start a second pass.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void runPrep();
    }
  }, [project, runPrep]);

  if (loading) {
    return (
      <Page>
        <Skeleton className="h-24 mb-6" />
        <div className="grid md:grid-cols-3 gap-4">
          <Skeleton className="h-40 md:col-span-2" />
          <Skeleton className="h-40" />
        </div>
      </Page>
    );
  }

  if (!project) {
    return (
      <Page>
        <EmptyState
          heading="We couldn't find that project."
          body="It may have been deleted, or it belongs to another account."
          action={<Button href="/dashboard">Back to dashboard</Button>}
        />
      </Page>
    );
  }

  const preparing = project.status === 'preparing';
  const failed = project.status === 'failed';
  const readiness = project.readiness ?? {};
  const stats = project.stats ?? {};
  const hasSessions = (stats.sessions_count ?? 0) > 0;

  const weakSkills = [...skills]
    .filter((s) => s.status !== 'STRONG')
    .sort((a, b) => (b.jd_importance ?? 0) - (a.jd_importance ?? 0) || (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 4);

  return (
    <Page>
      <ProjectHeader
        projectId={project.id}
        companyName={project.company_name}
        companyLogoUrl={project.company_logo_url}
        roleTitle={project.role_title}
        seniority={project.seniority}
        status={project.status}
        startDisabledReason={
          preparing
            ? 'We are still building your interview plan. This takes about a minute.'
            : failed
              ? 'Preparation failed. Retry it below before starting an interview.'
              : undefined
        }
      />

      {preparing && (
        <Card className="p-6 mb-6">
          <Eyebrow>Preparing</Eyebrow>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold mt-1 mb-4">
            Building your interview plan
          </h2>
          <StageList stages={PREP_STAGES} current={1} />
          <p className="mt-4 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
            About a minute. You can close this page — it keeps running.
          </p>
        </Card>
      )}

      {failed && (
        <div className="mb-6">
          <ErrorCard
            heading={`Preparation failed at the ${project.prep_error?.stage ?? 'first'} stage`}
            body={`${project.prep_error?.message ?? 'Something went wrong.'} No credits were spent — nothing is charged until you start an interview.`}
            action={
              <Button onClick={runPrep} disabled={retrying}>
                <RotateCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Retrying…' : 'Retry preparation'}
              </Button>
            }
          />
        </div>
      )}

      {/* Readiness — the emotional centre of the page */}
      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        <Card className="lg:col-span-2 p-6">
          <SectionTitle>Readiness</SectionTitle>

          {!hasSessions ? (
            // Never show a 0% ring here: a zero that means "no data" reads as a
            // zero that means "you're bad at this" (§6).
            <div className="flex items-center gap-5">
              <Target className="w-10 h-10 text-[#1B1F3B]/30 shrink-0" />
              <div>
                <p className="font-[family-name:var(--font-display)] font-bold text-[#1B1F3B]">
                  Run your first interview to see where you stand.
                </p>
                <p className="text-sm text-[#1B1F3B]/70 mt-1">
                  Readiness is built from what your interviews actually establish, not from your resume.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <ReadinessRing value={readiness.overall ?? null} size={120} />
              <div className="flex-1 w-full space-y-3">
                <ScoreBar label="Resume match" score={pct(readiness.resume_match)} />
                <ScoreBar label="Technical" score={pct(readiness.technical)} />
                <ScoreBar label="Behavioral" score={pct(readiness.behavioral)} />
                <ScoreBar label="Coding" score={pct(readiness.coding)} />
                <ScoreBar label="System design" score={pct(readiness.system_design)} />
              </div>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
          <StatTile label="Interviews" value={stats.sessions_count ?? 0} accent="sky" />
          <StatTile
            label="Average score"
            value={stats.avg_score != null ? stats.avg_score.toFixed(1) : '—'}
            accent="yellow"
          />
          <StatTile
            label="Best score"
            value={stats.best_score != null ? stats.best_score.toFixed(1) : '—'}
            accent="mint"
          />
        </div>
      </div>

      {/* Weak skills */}
      {weakSkills.length > 0 && (
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>What to work on</SectionTitle>
            <Link
              href={`/projects/${projectId}/gaps`}
              className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline shrink-0"
            >
              All gaps →
            </Link>
          </div>
          <div className="space-y-3">
            {weakSkills.map((s) => (
              <Link
                key={s.skill}
                href={`/projects/${projectId}/gaps`}
                className="flex items-center justify-between gap-3 p-3 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-2xl hover:bg-white transition-colors"
              >
                <span className="font-[family-name:var(--font-display)] font-bold text-sm">{s.skill}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <SkillStatusChip status={s.status} />
                  <span className="font-[family-name:var(--font-mono)] text-xs tabular-nums text-[#1B1F3B]/60">
                    {s.score != null ? s.score.toFixed(1) : 'not measured'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Recommended next — one recommendation, not a list. A list is a menu. */}
      {project.status === 'ready' && weakSkills.length > 0 && (
        <Card className="p-6 mb-6" accent="orange">
          <Eyebrow>Recommended next</Eyebrow>
          <h3 className="font-[family-name:var(--font-display)] text-xl font-extrabold mt-1 mb-3">
            Practise {weakSkills[0].skill} at medium difficulty
          </h3>
          <Button
            href={`/projects/${projectId}/interview/new?focus=${encodeURIComponent(
              weakSkills.slice(0, 2).map((s) => s.skill).join(','),
            )}`}
          >
            Set up that interview <ArrowRight className="w-4 h-4" />
          </Button>
        </Card>
      )}

      {/* Recent interviews */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <SectionTitle>Recent interviews</SectionTitle>
          <Link
            href={`/projects/${projectId}/history`}
            className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] hover:underline shrink-0"
          >
            See all →
          </Link>
        </div>

        {sessions.length === 0 ? (
          <p className="text-sm text-[#1B1F3B]/70">No interviews yet.</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={
                  s.status === 'complete'
                    ? `/sessions/${s.id}/report`
                    : `/sessions/${s.id}/processing`
                }
                className="flex items-center justify-between gap-3 p-3 border-2 border-[#1B1F3B] rounded-2xl hover:bg-[#F5EBE0] transition-colors"
              >
                <div>
                  <span className="font-[family-name:var(--font-display)] font-bold text-sm">
                    Interview {s.seq}
                  </span>
                  <span className="ml-2 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
                <span className="font-[family-name:var(--font-display)] font-extrabold tabular-nums">
                  {s.overall_score != null ? s.overall_score.toFixed(1) : s.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <AppHeader />
      <main className="max-w-[1100px] mx-auto px-4 md:px-8 py-8">{children}</main>
    </div>
  );
}

/** Readiness is stored 0-100; ScoreBar reads 0-10. */
function pct(value: number | undefined): number | null {
  return value == null ? null : value / 10;
}
