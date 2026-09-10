/**
 * /projects/[projectId] — Overview (sitemap-workflow.md §6).
 *
 * Everything important about this project on one screen. When `status` is
 * `preparing` the page renders its skeleton with a named stage strip and fills
 * in over realtime — the user is never held on a blocking spinner.
 *
 * Prep advances one short request at a time while this page is open (see
 * lib/api/drive-pipeline.ts). Closing the tab pauses it rather than losing it:
 * the model calls already started keep running, and reopening the page picks up
 * where it stopped.
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
import { drivePipeline } from '@/lib/api/drive-pipeline';
import { supabase } from '@/lib/supabase/client';

const PREP_STAGES = [
  'Reading your resume',
  'Reading the company site',
  'Comparing your resume to the role',
  'Planning the interview',
];

/**
 * Which strip entry each pipeline stage lights. The resume, the posting and the
 * company site are read in parallel, so `parsing` covers the first two.
 */
const PREP_STAGE_INDEX: Record<string, number> = { parsing: 1, gap: 2, strategy: 3 };

interface PrepResponse {
  pending?: boolean;
  status?: string;
  error?: string;
  progress?: { stage: string; detail: string | null } | null;
}

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
  /** The resume's ATS score against this job, 0-100. Null until prep has scored it. */
  const [resumeMatch, setResumeMatch] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [prepStage, setPrepStage] = useState(1);
  const prepTriggered = useRef(false);
  const prepAbort = useRef<AbortController | null>(null);

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
      const [{ data: skillRows }, { data: sessionRows }, { data: resumeRow }] = await Promise.all([
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
        /*
         * Resume match is read from the resume itself, not from the readiness
         * snapshot. It is known the moment prep finishes — before any interview
         * — and reading the source means every existing project shows the real
         * number, not the 0 the snapshot has always carried.
         */
        supabase
          .from('resumes')
          .select('ats')
          .eq('project_id', projectId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      setSkills((skillRows as SkillRow[]) ?? []);
      setSessions((sessionRows as SessionRow[]) ?? []);

      const atsScore = (resumeRow?.ats as { score?: unknown } | null)?.score;
      setResumeMatch(typeof atsScore === 'number' && Number.isFinite(atsScore) ? Math.round(atsScore) : null);
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

  // Drive the prep pipeline until it settles. There is no job queue, so the
  // open page is what moves the work forward — one short request at a time,
  // because the host ends any request at 30 seconds.
  const runPrep = useCallback(async () => {
    setRetrying(true);
    prepAbort.current?.abort();
    const controller = new AbortController();
    prepAbort.current = controller;

    try {
      await drivePipeline<PrepResponse>(
        () => fetch(`/api/projects/${projectId}/prep`, { method: 'POST' }),
        {
          signal: controller.signal,
          onUpdate: (body) => {
            const index = body.progress ? PREP_STAGE_INDEX[body.progress.stage] : undefined;
            if (index !== undefined) setPrepStage(index);
          },
        },
      );
    } finally {
      setRetrying(false);
      void load();
    }
  }, [projectId, load]);

  // Stop driving prep when the page goes away. The run is not lost — it waits
  // for the next time this page is opened.
  useEffect(() => () => prepAbort.current?.abort(), []);

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
        <OverviewSkeleton />
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
          <StageList stages={PREP_STAGES} current={prepStage} />
          <p className="mt-4 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
            About a minute. Keep this page open while it runs — if you leave, it picks up where it
            stopped when you come back.
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
            <div className="space-y-5">
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
              {/* The one dimension that needs no interview: how the resume reads
                  against this job's requirements. */}
              <div>
                <ScoreBar label="Resume match" score={pct(resumeMatch ?? undefined)} />
                <p className="text-xs text-[#1B1F3B]/60 mt-1.5">
                  How well your resume covers this job&apos;s requirements, from the ATS check.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <ReadinessRing value={readiness.overall ?? null} size={120} />
              <div className="flex-1 w-full space-y-3">
                <ScoreBar label="Resume match" score={pct(resumeMatch ?? readiness.resume_match)} />
                <ScoreBar label="Technical" score={pct(readiness.technical)} />
                <ScoreBar label="Behavioral" score={pct(readiness.behavioral)} />
                <ScoreBar label="Coding" score={pct(readiness.coding)} />
                <ScoreBar label="Skill challenge" score={pct(readiness.skill_challenge)} />
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

/**
 * The overview at its real dimensions, so nothing jumps when the data lands:
 * same header block, same three-column readiness row, same two cards below.
 * A centred spinner would be honest about waiting and dishonest about shape.
 */
function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading project">
      {/* Project header: logo, title block, start button */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Skeleton className="w-14 h-14 rounded-2xl shrink-0" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-52 md:w-64 rounded-2xl" />
              <Skeleton className="h-4 w-36 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-12 w-44 rounded-2xl" />
        </div>

        {/* Tab strip */}
        <div className="mt-6 flex gap-2">
          <Skeleton className="h-10 w-28 rounded-2xl" />
          <Skeleton className="h-10 w-32 rounded-2xl" />
          <Skeleton className="h-10 w-28 rounded-2xl" />
          <Skeleton className="h-10 w-24 rounded-2xl" />
        </div>
      </div>

      {/* Readiness + stat tiles */}
      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        <Skeleton className="lg:col-span-2 h-[260px]" />
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
          <Skeleton className="h-[76px] lg:h-20" />
          <Skeleton className="h-[76px] lg:h-20" />
          <Skeleton className="h-[76px] lg:h-20" />
        </div>
      </div>

      {/* What to work on */}
      <Skeleton className="h-56 mb-6" />

      {/* Recent interviews */}
      <Skeleton className="h-48" />
    </div>
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
