/**
 * /projects/[projectId]/plan — the preparation plan.
 *
 * Four things, in the order someone acts on them: the resume they could send
 * today, the resume they will have once the plan is done, the projects worth
 * building, and a timetable for the days that actually remain.
 *
 * ── What this page will not do ───────────────────────────────────────────────
 * It never presents a claim the candidate has not earned as one they have.
 *
 * That rule has two halves, because there are two resumes here. The sendable
 * one shows the source text behind every line, so an unsourced claim is visible
 * as unsourced. The target one is allowed to contain claims that are not true
 * yet — that is the point of it — but never silently: each is marked on screen,
 * gated behind a warning that tracks what the mock interviews have actually
 * verified, and marked again inside the text the Copy button produces.
 *
 * That last part is the one that matters. A banner on a page is advice; a
 * banner someone scrolled past an hour ago, on a document already pasted into
 * Word, is nothing at all.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ClipboardCopy,
  Hammer,
  Loader2,
  Sparkles,
} from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import ProjectHeader from '@/components/app/ProjectHeader';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorCard,
  Eyebrow,
  SectionTitle,
  Skeleton,
  StatTile,
} from '@/components/app/ui';
import { drivePipeline } from '@/lib/api/drive-pipeline';
import { supabase } from '@/lib/supabase/client';
import type { PrepPlan } from '@/lib/pipelines/prep-plan';
import { evaluatePreconditions, todayIso, type TargetReadiness } from '@/lib/engine/prep-window';

/** What the mock interviews have actually established, for the live warning. */
interface VerifiedSkill {
  skill: string;
  status: string | null;
  score: number | null;
}

interface ProjectShell {
  id: string;
  company_name: string;
  company_logo_url: string | null;
  role_title: string;
  seniority: string | null;
  status: string;
  interview_date: string | null;
  prep_plan: PrepPlan | null;
  active_resume_id: string | null;
}

/** What the plan route answers, while a build runs and once it settles. */
interface PlanResponse {
  pending?: boolean;
  status?: string;
  plan?: PrepPlan;
  interviewDate?: string;
  progress?: { stage: string; detail: string | null } | null;
  error?: string;
}

function postPlan(projectId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`/api/projects/${projectId}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const KIND_ACCENT: Record<string, 'sky' | 'mint' | 'yellow' | 'coral' | 'orange'> = {
  study: 'sky',
  build: 'orange',
  practice: 'yellow',
  review: 'mint',
  rest: 'mint',
};

export default function PrepPlanPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [project, setProject] = useState<ProjectShell | null>(null);
  const [verified, setVerified] = useState<VerifiedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data }, { data: skills }] = await Promise.all([
        supabase
          .from('projects')
          .select(
            'id, company_name, company_logo_url, role_title, seniority, status, interview_date, prep_plan, active_resume_id',
          )
          .eq('id', projectId)
          .maybeSingle(),
        // Read fresh on every visit. The target resume's warning is computed
        // from this, so a stale copy would keep telling someone to prove a
        // skill they proved in last week's interview.
        supabase
          .from('skill_progress')
          .select('skill, status, score')
          .eq('project_id', projectId)
          .limit(40),
      ]);

      const proj = data as ProjectShell | null;
      setProject(proj);
      setVerified((skills as VerifiedSkill[]) ?? []);
      setDate(proj?.interview_date ?? '');
      setLoading(false);
    })();
  }, [projectId]);

  const applyPlan = useCallback((body: PlanResponse) => {
    if (!body.plan) return;
    setProject((p) =>
      p
        ? { ...p, prep_plan: body.plan as PrepPlan, interview_date: body.interviewDate ?? p.interview_date }
        : p,
    );
  }, []);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStage(null);
    try {
      const outcome = await drivePipeline<PlanResponse>(
        // The first request starts the build; every one after it advances it.
        (answered) => postPlan(projectId, answered === 0 ? { interviewDate: date } : { continue: true }),
        { onUpdate: (body) => setStage(body.progress?.stage ?? null) },
      );

      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      applyPlan(outcome.body);
    } finally {
      setBusy(false);
    }
  }, [projectId, date, applyPlan]);

  /*
   * Picks up a build that was still running when this page was last closed or
   * reloaded. A build only advances while a page is asking for it, so without
   * this it would sit half-finished until someone pressed Rebuild.
   */
  useEffect(() => {
    const controller = new AbortController();
    let following = false;

    void drivePipeline<PlanResponse>(() => postPlan(projectId, { continue: true }), {
      signal: controller.signal,
      onUpdate: (body) => {
        if (!body.pending) return;
        following = true;
        setBusy(true);
        setStage(body.progress?.stage ?? null);
      },
    }).then((outcome) => {
      // Nothing was running, or the page has gone: leave it exactly as loaded.
      if (!following || controller.signal.aborted) return;
      setBusy(false);
      if (outcome.ok) applyPlan(outcome.body);
      else setError(outcome.error);
    });

    return () => controller.abort();
  }, [projectId, applyPlan]);

  const plan = project?.prep_plan ?? null;

  /*
   * Whether what is on screen was built for the situation the user is in now.
   *
   * A plan is a dated document derived from a specific resume, so two things
   * quietly invalidate it: the interview moves, or a new resume is uploaded.
   * Neither changes the stored plan, so without this the page would present a
   * schedule for the wrong fortnight with complete confidence.
   */
  const staleness = useMemo(() => {
    if (!plan || !project) return null;
    if (project.interview_date && plan.interview_date !== project.interview_date) {
      return 'The interview date has changed since this plan was built. Regenerate it.';
    }
    if (project.active_resume_id && plan.resume_id && plan.resume_id !== project.active_resume_id) {
      return 'This was built from an earlier version of your resume. Regenerate it.';
    }
    // The plan itself has simply been overtaken by time.
    if (plan.interview_date < todayIso()) {
      return 'This plan was for an interview date that has now passed.';
    }
    return null;
  }, [plan, project]);

  if (loading) {
    return (
      <Page>
        <Skeleton className="h-24 mb-6" />
        <Skeleton className="h-96" />
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

  const daysUntil = plan?.window.daysUntil ?? null;

  return (
    <Page>
      <ProjectHeader
        projectId={project.id}
        companyName={project.company_name}
        companyLogoUrl={project.company_logo_url}
        roleTitle={project.role_title}
        seniority={project.seniority}
        status={project.status}
      />

      {/* ── When is it ──────────────────────────────────────────────────── */}
      <Card className="p-6 mb-6" accent="orange">
        <SectionTitle sub="Everything below is built around this date — how many days there are decides what the plan can honestly cover.">
          When is the interview?
        </SectionTitle>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[#1B1F3B]/60 mb-2">
              Interview date
            </span>
            <input
              type="date"
              value={date}
              min={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              className="px-4 py-3 bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-2xl text-sm focus:outline-none focus:bg-white"
            />
          </label>

          <Button onClick={() => void generate()} disabled={!date || busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy ? 'Building…' : plan ? 'Rebuild plan' : 'Build my plan'}
          </Button>
        </div>

        {busy && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
            {stage === 'target'
              ? 'Projecting your resume forward to where the plan leads.'
              : 'Rewriting your resume and scheduling the days.'}{' '}
            This runs in two passes and takes a minute or two — keep this page open while it builds.
          </p>
        )}

        {project.status !== 'ready' && (
          <p className="mt-3 text-sm text-[#1B1F3B]/75">
            This project is still preparing. The plan is built from its gap analysis, so that has to
            finish first.
          </p>
        )}

        {error && (
          <div className="mt-4">
            <ErrorCard heading="That didn't work" body={error} />
          </div>
        )}
      </Card>

      {!plan ? (
        <EmptyState
          heading="No plan yet"
          body="Set the interview date above and we'll write two resumes — the one you could send today, and the one you'll have once the plan is done — plus the projects worth building and a day-by-day schedule for the time you have left."
        />
      ) : (
        <>
          {staleness && (
            <Card className="p-4 mb-6" accent="yellow">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm text-[#1B1F3B]">{staleness}</p>
              </div>
            </Card>
          )}

          {plan.partial && (
            <Card className="p-4 mb-6" accent="coral">
              <p className="text-sm text-[#1B1F3B]">{plan.partial}</p>
            </Card>
          )}

          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <StatTile
              label="Days to go"
              value={daysUntil ?? '—'}
              accent={
                plan.window.pressure === 'crash'
                  ? 'coral'
                  : plan.window.pressure === 'tight'
                    ? 'yellow'
                    : 'mint'
              }
              hint={
                plan.window.pressure === 'crash'
                  ? 'Triage only'
                  : plan.window.pressure === 'tight'
                    ? 'Focus on the top gaps'
                    : 'Room to go deep'
              }
            />
            <StatTile
              label="Scheduled days"
              value={plan.schedule.length}
              accent="sky"
              hint={plan.window.leadDays > 0 ? `+${plan.window.leadDays} days of lead time before` : undefined}
            />
            <StatTile
              label="ATS gain"
              value={plan.resume ? `+${plan.resume.projected_ats_gain}` : '—'}
              accent="orange"
              hint="Projected, from keyword alignment"
            />
          </div>

          {plan.plan?.verdict && (
            <Card className="p-6 mb-6">
              <Eyebrow>The honest read</Eyebrow>
              <p className="mt-2 text-[#1B1F3B] leading-relaxed">{plan.plan.verdict}</p>
            </Card>
          )}

          {(plan.resume || plan.target) && (
            <ResumeSection resume={plan.resume} target={plan.target} verified={verified} />
          )}

          {plan.plan && plan.plan.projects_to_build.length > 0 && (
            <ProjectsToBuild projects={plan.plan.projects_to_build} />
          )}

          {plan.schedule.length > 0 && (
            <Timetable schedule={plan.schedule} dayBefore={plan.plan?.day_before ?? []} plan={plan} />
          )}

          {plan.plan && plan.plan.risks.length > 0 && (
            <Card className="p-6 mb-6">
              <SectionTitle>What usually derails this</SectionTitle>
              <ul className="space-y-2">
                {plan.plan.risks.map((r, i) => (
                  <li key={i} className="text-sm text-[#1B1F3B]/85 flex gap-2">
                    <span className="text-[#FF5C7A] font-bold">·</span>
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="mt-2 mb-10 text-center font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50">
            Built {new Date(plan.generated_at).toLocaleDateString()} for {plan.interview_date}
          </p>
        </>
      )}
    </Page>
  );
}

// ── The resume ───────────────────────────────────────────────────────────────

/**
 * The two resumes, behind one toggle.
 *
 * "Send today" is the default and always will be. It is the document that is
 * safe to attach to an application, and the one someone reaching for their
 * resume in a hurry should land on without choosing anything. The target is
 * opt-in, because it contains claims that are not true yet.
 */
function ResumeSection({
  resume,
  target,
  verified,
}: {
  resume: PrepPlan['resume'];
  target: PrepPlan['target'];
  verified: VerifiedSkill[];
}) {
  const [mode, setMode] = useState<'now' | 'target'>('now');

  // Live, not frozen at generation time — as skills verify STRONG in mock
  // interviews the warning shrinks on its own, and clears when the last lands.
  const readiness = useMemo<TargetReadiness | null>(
    () => (target ? evaluatePreconditions(target.preconditions, verified) : null),
    [target, verified],
  );

  const showing = mode === 'now' ? Boolean(resume) : Boolean(target);

  return (
    <div className="mb-6">
      {resume && target && (
        <div className="flex flex-wrap gap-2 mb-3">
          <TabButton active={mode === 'now'} onClick={() => setMode('now')}>
            Send today
          </TabButton>
          <TabButton active={mode === 'target'} onClick={() => setMode('target')}>
            After the plan
            {readiness && !readiness.allMet && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-[#FF5C7A] text-white text-[10px]">
                {readiness.total - readiness.met} to go
              </span>
            )}
          </TabButton>
        </div>
      )}

      {mode === 'now' && resume && <IdealResumeCard resume={resume} />}
      {mode === 'target' && target && <TargetResumeCard target={target} readiness={readiness} />}

      {!showing && (
        <Card className="p-6">
          <p className="text-sm text-[#1B1F3B]/75">
            {mode === 'now'
              ? 'The sendable rewrite did not generate. Rebuild the plan to try again.'
              : 'No target resume was generated — your resume already evidences what this role asks for.'}
          </p>
        </Card>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-2xl border-4 border-[#1B1F3B] font-[family-name:var(--font-display)] text-sm font-bold transition-all ${
        active
          ? 'bg-[#1B1F3B] text-white shadow-[3px_3px_0_#FF6B35]'
          : 'bg-white text-[#1B1F3B] shadow-[3px_3px_0_#1B1F3B] hover:-translate-y-0.5'
      }`}
    >
      {children}
    </button>
  );
}

type ResumeLine = NonNullable<PrepPlan['resume']>['lines'][number];

function IdealResumeCard({ resume }: { resume: NonNullable<PrepPlan['resume']> }) {
  const [showSources, setShowSources] = useState(false);
  const [copied, setCopied] = useState(false);

  const { headline, summary, lines } = resume;

  // Grouped here rather than in the schema: the agent emits a flat list because
  // that is what a model fills reliably, and the tree only matters for display.
  const sections = useMemo(() => {
    const bySection = new Map<string, Map<string, ResumeLine[]>>();
    for (const line of lines) {
      const entries = bySection.get(line.section) ?? new Map<string, ResumeLine[]>();
      entries.set(line.entry, [...(entries.get(line.entry) ?? []), line]);
      bySection.set(line.section, entries);
    }
    return [...bySection.entries()];
  }, [lines]);

  const asText = useMemo(() => {
    const out: string[] = [headline, '', summary, ''];
    for (const [section, entries] of sections) {
      out.push(section.toUpperCase(), '');
      for (const [entry, lines] of entries) {
        if (entry) out.push(entry);
        for (const l of lines) out.push(`  - ${l.text}`);
        out.push('');
      }
    }
    return out.join('\n').trim();
  }, [headline, summary, sections]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is on screen and selectable anyway */
    }
  }, [asText]);

  return (
    <Card className="p-6 md:p-8 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle sub="Every line is a rewrite of something you already wrote. Nothing here claims experience you don't have.">
          The resume you could be sending
        </SectionTitle>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" onClick={() => setShowSources((s) => !s)}>
            {showSources ? 'Hide' : 'Show'} originals
          </Button>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <div className="border-4 border-[#1B1F3B] rounded-2xl p-5 bg-[#FFFDF9]">
        <p className="font-[family-name:var(--font-display)] text-xl font-extrabold">{resume.headline}</p>
        <p className="mt-2 text-sm text-[#1B1F3B]/85 leading-relaxed">{resume.summary}</p>

        {sections.map(([section, entries]) => (
          <div key={section} className="mt-6">
            <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 border-b-2 border-[#1B1F3B]/20 pb-1 mb-3">
              {section}
            </p>
            {[...entries].map(([entry, lines]) => (
              <div key={entry || 'root'} className="mb-4">
                {entry && <p className="font-bold text-sm text-[#1B1F3B] mb-1.5">{entry}</p>}
                <ul className="space-y-2">
                  {lines.map((line, i) => (
                    <li key={i} className="text-sm text-[#1B1F3B]/90">
                      <div className="flex gap-2">
                        <span className="text-[#FF6B35] font-bold shrink-0">·</span>
                        <div className="min-w-0">
                          <span>{line.text}</span>
                          {line.keywords.length > 0 && (
                            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                              {line.keywords.map((k) => (
                                <span
                                  key={k}
                                  className="px-1.5 py-0.5 rounded bg-[#6EE7B7]/40 font-[family-name:var(--font-mono)] text-[10px] font-bold"
                                >
                                  {k}
                                </span>
                              ))}
                            </span>
                          )}

                          {/*
                           * The provenance. A line with no `original` is new
                           * structure, and says so rather than being presented
                           * as a rewrite of something that does not exist.
                           */}
                          {showSources && (
                            <p className="mt-1 text-xs text-[#1B1F3B]/55 border-l-2 border-[#1B1F3B]/20 pl-2">
                              {line.original ? (
                                <>
                                  <span className="line-through">{line.original}</span>
                                  <span className="block mt-0.5 not-italic">{line.why}</span>
                                </>
                              ) : (
                                <span className="italic">New structure — not a rewrite of an existing line.</span>
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>

      {resume.cannot_claim_yet.length > 0 && (
        <div className="mt-6 p-5 border-4 border-[#FF5C7A] rounded-2xl bg-[#FF5C7A]/8">
          <Eyebrow>What this resume can&apos;t claim yet</Eyebrow>
          <p className="mt-1 mb-3 text-sm text-[#1B1F3B]/75">
            The role wants these and no rewording would make them true. Each one has the smallest
            real thing that would earn it.
          </p>
          <ul className="space-y-3">
            {resume.cannot_claim_yet.map((c, i) => (
              <li key={i} className="text-sm">
                <span className="font-bold text-[#1B1F3B]">{c.skill}</span>
                <span className="block text-[#1B1F3B]/80 mt-0.5">{c.what_would_earn_it}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        {resume.removed.length > 0 && (
          <div>
            <Eyebrow>Cut, and why</Eyebrow>
            <ul className="mt-2 space-y-2">
              {resume.removed.map((r, i) => (
                <li key={i} className="text-sm text-[#1B1F3B]/75">
                  <span className="line-through">{r.text}</span>
                  <span className="block text-xs mt-0.5">{r.why}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {resume.ats_notes.length > 0 && (
          <div>
            <Eyebrow>Formatting & ATS</Eyebrow>
            <ul className="mt-2 space-y-1.5">
              {resume.ats_notes.map((n, i) => (
                <li key={i} className="text-sm text-[#1B1F3B]/75">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── The target resume ────────────────────────────────────────────────────────

type TargetLine = NonNullable<PrepPlan['target']>['lines'][number];

function TargetResumeCard({
  target,
  readiness,
}: {
  target: NonNullable<PrepPlan['target']>;
  readiness: TargetReadiness | null;
}) {
  const [copied, setCopied] = useState(false);
  const { headline, summary, lines } = target;

  const sections = useMemo(() => {
    const bySection = new Map<string, Map<string, TargetLine[]>>();
    for (const line of lines) {
      const entries = bySection.get(line.section) ?? new Map<string, TargetLine[]>();
      entries.set(line.entry, [...(entries.get(line.entry) ?? []), line]);
      bySection.set(line.section, entries);
    }
    return [...bySection.entries()];
  }, [lines]);

  const earnedCount = lines.filter((l) => l.status === 'earned').length;
  const ready = readiness?.allMet ?? false;

  /*
   * ── The warning travels with the text ────────────────────────────────────
   *
   * This is the part that actually protects anyone. A banner on a page is
   * advice; a banner someone has already scrolled past, on a document they
   * copied into a Word file an hour ago, is nothing at all.
   *
   * So the copied text opens with the warning, and every not-yet-true line is
   * marked inline with what would earn it. Someone who pastes this into their
   * resume and starts editing cannot avoid seeing which lines they have not
   * earned — they would have to delete the markers one by one, which is a
   * decision rather than an accident.
   *
   * When every precondition has actually been verified the markers come off,
   * because at that point the lines are true and marking them would be false in
   * the other direction.
   */
  const asText = useMemo(() => {
    const out: string[] = [];

    if (!ready) {
      out.push(
        '=============================================================',
        '  TARGET RESUME — NOT YET ACCURATE. DO NOT SEND THIS VERSION.',
        '=============================================================',
        '',
        `${earnedCount} line${earnedCount === 1 ? '' : 's'} below are marked [NOT YET — …]. They are not`,
        'true today. They become true when you have done the work named',
        'against them.',
        '',
      );
      if (readiness && readiness.total > 0) {
        out.push(`Still to prove (${readiness.total - readiness.met} of ${readiness.total}):`);
        for (const s of readiness.statuses.filter((x) => x.state !== 'met')) {
          out.push(`  - ${s.skill} — ${s.detail}`);
        }
        out.push('');
      }
      out.push('-------------------------------------------------------------', '');
    }

    out.push(headline, '', summary, '');

    for (const [section, entries] of sections) {
      out.push(section.toUpperCase(), '');
      for (const [entry, entryLines] of entries) {
        if (entry) out.push(entry);
        for (const l of entryLines) {
          const marker = !ready && l.status === 'earned' ? `  [NOT YET — ${l.unlocked_by}]` : '';
          out.push(`  - ${l.text}${marker}`);
        }
        out.push('');
      }
    }

    return out.join('\n').trim();
  }, [headline, summary, sections, earnedCount, ready, readiness]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is on screen and selectable anyway */
    }
  }, [asText]);

  return (
    <Card className="p-6 md:p-8" accent={ready ? 'mint' : 'coral'}>
      {/* ── The warning ─────────────────────────────────────────────────── */}
      <div
        className={`p-5 border-4 border-[#1B1F3B] rounded-2xl mb-6 ${
          ready ? 'bg-[#6EE7B7]/25' : 'bg-[#FF5C7A]/12'
        }`}
      >
        <div className="flex items-start gap-3">
          {ready ? (
            <Check className="w-6 h-6 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B]">
              {ready
                ? 'You have earned this one. It is safe to send.'
                : 'This is not your resume yet — do not send it.'}
            </p>
            <p className="mt-1 text-sm text-[#1B1F3B]/85 leading-relaxed">
              {ready
                ? 'Every skill this version claims has been verified strong in your mock interviews. The lines below are now true.'
                : `This is where your prep plan leads. ${earnedCount} of the ${lines.length} lines below are not true today — they become true once you have closed the gaps and built the projects in your plan. Sending this version now would put you in a room defending work you have not done.`}
            </p>
          </div>
        </div>

        {/* The live gate. This is what makes the warning worth reading twice —
            it moves as the candidate actually improves. */}
        {readiness && readiness.total > 0 && (
          <div className="mt-4 pt-4 border-t-2 border-[#1B1F3B]/15">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <Eyebrow>What has to be true first</Eyebrow>
              <Chip accent={ready ? 'mint' : readiness.met > 0 ? 'yellow' : 'coral'}>
                {readiness.met} of {readiness.total} verified
              </Chip>
            </div>
            <ul className="space-y-1.5">
              {readiness.statuses.map((s) => (
                <li key={s.skill} className="flex items-start gap-2 text-sm">
                  <span
                    className="shrink-0 mt-1 w-3 h-3 rounded-full border-2 border-[#1B1F3B]"
                    style={{
                      backgroundColor:
                        s.state === 'met' ? '#6EE7B7' : s.state === 'progressing' ? '#FFC93C' : '#FF5C7A',
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-bold text-[#1B1F3B]">{s.skill}</span>
                    <span className="text-[#1B1F3B]/70"> — {s.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {!ready && (
              <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                These update on their own as your mock interviews verify each skill.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle sub="Same jobs, same dates, same you. What changes is what you can credibly say once the plan is done.">
          The resume you&apos;re working towards
        </SectionTitle>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
          {copied ? 'Copied' : ready ? 'Copy' : 'Copy with warning'}
        </Button>
      </div>

      <div className="border-4 border-[#1B1F3B] rounded-2xl p-5 bg-[#FFFDF9]">
        <p className="font-[family-name:var(--font-display)] text-xl font-extrabold">{headline}</p>
        <p className="mt-2 text-sm text-[#1B1F3B]/85 leading-relaxed">{summary}</p>

        {sections.map(([section, entries]) => (
          <div key={section} className="mt-6">
            <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 border-b-2 border-[#1B1F3B]/20 pb-1 mb-3">
              {section}
            </p>
            {[...entries].map(([entry, entryLines]) => (
              <div key={entry || 'root'} className="mb-4">
                {entry && <p className="font-bold text-sm text-[#1B1F3B] mb-1.5">{entry}</p>}
                <ul className="space-y-2">
                  {entryLines.map((line, i) => {
                    const notYet = line.status === 'earned' && !ready;
                    return (
                      <li key={i} className="text-sm">
                        <div className="flex gap-2">
                          <span
                            className={`font-bold shrink-0 ${notYet ? 'text-[#FF5C7A]' : 'text-[#6EE7B7]'}`}
                          >
                            ·
                          </span>
                          <div className="min-w-0">
                            {/* Dashed underline on an unearned line: visible at a
                                glance while scanning, without making the document
                                unreadable as a resume. */}
                            <span
                              className={
                                notYet
                                  ? 'text-[#1B1F3B]/90 decoration-dashed decoration-[#FF5C7A] underline underline-offset-4'
                                  : 'text-[#1B1F3B]/90'
                              }
                            >
                              {line.text}
                            </span>

                            {notYet && (
                              <p className="mt-1 text-xs text-[#1B1F3B]/70 flex flex-wrap items-baseline gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-[#FF5C7A]/25 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase">
                                  Not yet
                                </span>
                                <span>{line.unlocked_by}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>

      {target.gap_summary && (
        <div className="mt-6 p-4 border-2 border-[#1B1F3B] rounded-2xl bg-[#F5EBE0]">
          <Eyebrow>How far away is this</Eyebrow>
          <p className="mt-1 text-sm text-[#1B1F3B]/85 leading-relaxed">{target.gap_summary}</p>
        </div>
      )}
    </Card>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

function ProjectsToBuild({
  projects,
}: {
  projects: NonNullable<PrepPlan['plan']>['projects_to_build'];
}) {
  return (
    <Card className="p-6 md:p-8 mb-6" accent="sky">
      <SectionTitle sub="Your resume lists these skills but shows no work behind them. An interviewer discounts a skill with nothing under it — these are the smallest things that would fix that.">
        Build these before the interview
      </SectionTitle>

      <div className="space-y-4">
        {projects.map((p, i) => (
          <div key={i} className="border-2 border-[#1B1F3B] rounded-2xl overflow-hidden">
            <div className="bg-[#F5EBE0] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-[family-name:var(--font-display)] font-extrabold flex items-center gap-2">
                <Hammer className="w-4 h-4" />
                {p.name}
              </span>
              <Chip>~{p.est_hours}h</Chip>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-[#1B1F3B]/85">{p.pitch}</p>

              <div>
                <Eyebrow>Done means</Eyebrow>
                <p className="mt-1 text-sm text-[#1B1F3B]/85">{p.scope}</p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {p.builds_evidence_for.map((s) => (
                  <Chip key={s} accent="mint">
                    {s}
                  </Chip>
                ))}
              </div>

              {/* The payoff, stated as the line they earn. Deliberately worded
                  as conditional on the thing actually working. */}
              <div className="p-3 bg-[#FFC93C]/20 border-2 border-[#1B1F3B] rounded-xl">
                <Eyebrow>Once it works, your resume can say</Eyebrow>
                <p className="mt-1 text-sm font-medium text-[#1B1F3B]">{p.resume_bullet}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── The timetable ────────────────────────────────────────────────────────────

function Timetable({
  schedule,
  dayBefore,
  plan,
}: {
  schedule: PrepPlan['schedule'];
  dayBefore: string[];
  plan: PrepPlan;
}) {
  const today = todayIso();

  // Grouped into weeks of seven from the plan's first day, which is how people
  // actually hold a schedule in their head.
  const weeks = useMemo(() => {
    const out = new Map<number, PrepPlan['schedule']>();
    for (const block of schedule) {
      const week = Math.floor(block.offset / 7);
      out.set(week, [...(out.get(week) ?? []), block]);
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0]);
  }, [schedule]);

  const totalHours = schedule.reduce((sum, b) => sum + b.estHours, 0);

  return (
    <Card className="p-6 md:p-8 mb-6">
      <SectionTitle
        sub={`${schedule.length} days, about ${Math.round(totalHours)} hours in total. Dates are real — check them against your own week.`}
      >
        Your schedule
      </SectionTitle>

      {plan.window.leadDays > 0 && (
        <p className="mb-4 text-sm text-[#1B1F3B]/70">
          Your interview is {plan.window.daysUntil} days away. This plans the final{' '}
          {plan.window.planDays} — a day-by-day schedule further out than six weeks is fiction, and
          the weeks right before the interview are the ones worth planning.
        </p>
      )}

      <div className="space-y-6">
        {weeks.map(([weekIndex, blocks]) => (
          <div key={weekIndex}>
            <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 mb-2">
              Week {weekIndex + 1}
            </p>
            <div className="space-y-2">
              {blocks.map((b) => {
                const isToday = b.date === today;
                const isPast = b.date < today;
                return (
                  <div
                    key={b.offset}
                    className={`flex flex-wrap gap-3 p-3 border-2 rounded-2xl transition-opacity ${
                      isToday
                        ? 'border-[#FF6B35] bg-[#FF6B35]/8 shadow-[3px_3px_0_#FF6B35]'
                        : 'border-[#1B1F3B] bg-white'
                    } ${isPast ? 'opacity-45' : ''}`}
                  >
                    <div className="w-20 shrink-0">
                      <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase text-[#1B1F3B]/55">
                        {b.weekday}
                      </p>
                      <p className="font-[family-name:var(--font-display)] font-extrabold text-sm tabular-nums">
                        {b.date.slice(5)}
                      </p>
                      {isToday && <Chip accent="orange">Today</Chip>}
                    </div>

                    <div className="flex-1 min-w-[200px]">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Chip accent={KIND_ACCENT[b.kind] ?? 'sky'}>{b.kind}</Chip>
                        <span className="font-bold text-sm text-[#1B1F3B]">{b.focus}</span>
                        <Chip>{b.estHours}h</Chip>
                      </div>
                      <ul className="space-y-0.5">
                        {b.tasks.map((t, i) => (
                          <li key={i} className="text-sm text-[#1B1F3B]/80 flex gap-2">
                            <span className="text-[#1B1F3B]/35">·</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {dayBefore.length > 0 && (
        <div className="mt-6 p-5 border-4 border-[#1B1F3B] rounded-2xl bg-[#6EE7B7]/15">
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="w-4 h-4" />
            <Eyebrow>The day before</Eyebrow>
          </div>
          <ul className="space-y-1.5">
            {dayBefore.map((d, i) => (
              <li key={i} className="text-sm text-[#1B1F3B]/85 flex gap-2">
                <span className="text-[#1B1F3B]/40">·</span>
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
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
