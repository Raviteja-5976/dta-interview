/**
 * /projects/[projectId]/gaps — Gap Analysis (sitemap-workflow.md §7).
 *
 * The most valuable page in the app, and the one every report links back into.
 *
 * The distinction it exists to make visible: the initial gap report (P4) is what
 * your RESUME claims versus what the ROLE needs. `skill_progress` is what the
 * INTERVIEWS actually established. Labelled Claimed and Verified, side by side.
 * The gap between those two columns is the single most useful thing this product
 * tells anyone.
 */

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import ProjectHeader from '@/components/app/ProjectHeader';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  SectionTitle,
  Skeleton,
  SkillStatusChip,
} from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

interface GapSkill {
  skill: string;
  status: string;
  jd_importance: number;
  resume_evidence: string;
  rationale: string;
  investigation_priority: number;
}

interface VerifiedSkill {
  skill: string;
  status: string | null;
  score: number | null;
  confidence: number | null;
  depth: string | null;
  sessions_seen: number;
  jd_importance: number | null;
}

interface ProjectShell {
  id: string;
  company_name: string;
  company_logo_url: string | null;
  role_title: string;
  seniority: string | null;
  status: string;
  gap_report: { skills?: GapSkill[]; summary?: string; top_investigations?: string[] } | null;
}

export default function GapsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectShell | null>(null);
  const [verified, setVerified] = useState<VerifiedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // This tab names gap_report specifically — one artifact column, per the
      // tab-as-route data pattern (db-design.md §6).
      const [{ data: proj }, { data: skills }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, company_name, company_logo_url, role_title, seniority, status, gap_report')
          .eq('id', projectId)
          .maybeSingle(),
        supabase
          .from('skill_progress')
          .select('skill, status, score, confidence, depth, sessions_seen, jd_importance')
          .eq('project_id', projectId),
      ]);

      setProject(proj as ProjectShell | null);
      setVerified((skills as VerifiedSkill[]) ?? []);
      setLoading(false);
    })();
  }, [projectId]);

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

  const claimed = project.gap_report?.skills ?? [];
  const verifiedBySkill = new Map(verified.map((v) => [v.skill.toLowerCase(), v]));

  // Sorted by JD importance, then ascending score — most important and least
  // proven first, which is the order a candidate should read them in.
  const rows = [...claimed].sort(
    (a, b) =>
      b.jd_importance - a.jd_importance ||
      (verifiedBySkill.get(a.skill.toLowerCase())?.score ?? 0) -
        (verifiedBySkill.get(b.skill.toLowerCase())?.score ?? 0),
  );

  const strengths = rows.filter((r) => {
    const v = verifiedBySkill.get(r.skill.toLowerCase());
    return v?.score != null && v.score >= 7;
  });

  const toWorkOn = rows.filter((r) => {
    const v = verifiedBySkill.get(r.skill.toLowerCase());
    return (v?.score != null && v.score < 6) || r.status === 'MISSING' || r.status === 'WEAK';
  });

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

      {rows.length === 0 ? (
        <EmptyState
          heading="No gap analysis yet."
          body="This project is still preparing, or preparation did not finish. The gap analysis appears once it does."
          action={<Button href={`/projects/${projectId}`}>Back to overview</Button>}
        />
      ) : (
        <>
          {project.gap_report?.summary && (
            <Card className="p-6 mb-6">
              <Eyebrow>Where you stand</Eyebrow>
              <p className="mt-2 text-[#1B1F3B] leading-relaxed">{project.gap_report.summary}</p>
            </Card>
          )}

          {/* The matrix */}
          <Card className="p-6 mb-6">
            <SectionTitle sub="Claimed is what your resume asserts against this role. Verified is what your interviews actually established.">
              Skill matrix
            </SectionTitle>

            <div className="hidden md:grid grid-cols-12 gap-3 pb-2 mb-2 border-b-2 border-[#1B1F3B]/20">
              <span className="col-span-4 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/60">
                Skill
              </span>
              <span className="col-span-3 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/60">
                Claimed
              </span>
              <span className="col-span-5 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/60">
                Verified
              </span>
            </div>

            <div className="space-y-2">
              {rows.map((row) => {
                const v = verifiedBySkill.get(row.skill.toLowerCase());
                const open = expanded === row.skill;

                return (
                  <div key={row.skill} className="border-2 border-[#1B1F3B] rounded-2xl overflow-hidden">
                    <button
                      onClick={() => setExpanded(open ? null : row.skill)}
                      className="w-full grid md:grid-cols-12 gap-3 items-center p-3 text-left hover:bg-[#F5EBE0] transition-colors"
                    >
                      <div className="md:col-span-4 flex items-center gap-2">
                        <span className="font-[family-name:var(--font-display)] font-bold text-sm">
                          {row.skill}
                        </span>
                        <span
                          title={`JD importance ${(row.jd_importance * 100).toFixed(0)}%`}
                          className="font-[family-name:var(--font-mono)] text-[10px] text-[#1B1F3B]/50 tabular-nums"
                        >
                          {(row.jd_importance * 100).toFixed(0)}%
                        </span>
                      </div>

                      <div className="md:col-span-3">
                        <SkillStatusChip status={row.status} />
                      </div>

                      <div className="md:col-span-5 flex items-center gap-3">
                        {v?.score != null ? (
                          <>
                            <div className="flex-1 h-3 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-full overflow-hidden min-w-[80px]">
                              <div
                                style={{
                                  width: `${(v.score / 10) * 100}%`,
                                  backgroundColor:
                                    v.score >= 7 ? '#6EE7B7' : v.score >= 5 ? '#FFC93C' : '#FF5C7A',
                                }}
                                className="h-full"
                              />
                            </div>
                            <span className="font-[family-name:var(--font-mono)] text-xs font-bold tabular-nums shrink-0">
                              {v.score.toFixed(1)}
                            </span>
                            <span className="font-[family-name:var(--font-mono)] text-[10px] text-[#1B1F3B]/50 shrink-0 hidden lg:inline">
                              {v.depth ?? '—'} · {v.sessions_seen}×
                            </span>
                          </>
                        ) : (
                          <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50">
                            Not established yet
                          </span>
                        )}
                      </div>
                    </button>

                    {open && (
                      <div className="px-4 pb-4 pt-1 bg-[#F5EBE0] border-t-2 border-[#1B1F3B]/20">
                        <p className="text-sm text-[#1B1F3B]/80">{row.rationale}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <Chip>Resume: {row.resume_evidence.replace(/_/g, ' ')}</Chip>
                          <Chip accent="sky">
                            Investigate: {(row.investigation_priority * 100).toFixed(0)}%
                          </Chip>
                          {v?.confidence != null && (
                            <Chip>Confidence {(v.confidence * 100).toFixed(0)}%</Chip>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Two columns */}
          <div className="grid md:grid-cols-2 gap-5 mb-6">
            <Card className="p-6" accent="mint">
              <SectionTitle>Strengths</SectionTitle>
              {strengths.length === 0 ? (
                <p className="text-sm text-[#1B1F3B]/70">
                  Nothing verified as strong yet — that takes an interview, not a resume.
                </p>
              ) : (
                <ul className="space-y-2">
                  {strengths.map((s) => (
                    <li key={s.skill} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-bold">{s.skill}</span>
                      <span className="font-[family-name:var(--font-mono)] tabular-nums">
                        {verifiedBySkill.get(s.skill.toLowerCase())?.score?.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-6" accent="coral">
              <SectionTitle>What to work on</SectionTitle>
              <ul className="space-y-2">
                {toWorkOn.slice(0, 8).map((s) => (
                  <li key={s.skill} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-bold">{s.skill}</span>
                    <SkillStatusChip status={s.status} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* The loop: gaps → new interview, pre-filled */}
          <Card className="p-6" accent="orange">
            <Eyebrow>Close the gap</Eyebrow>
            <h3 className="font-[family-name:var(--font-display)] text-xl font-extrabold mt-1 mb-4">
              Practise these skills
            </h3>
            <Button
              href={`/projects/${projectId}/interview/new?focus=${encodeURIComponent(
                toWorkOn.slice(0, 3).map((s) => s.skill).join(','),
              )}`}
            >
              Set up a targeted interview <ArrowRight className="w-4 h-4" />
            </Button>
          </Card>
        </>
      )}
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
