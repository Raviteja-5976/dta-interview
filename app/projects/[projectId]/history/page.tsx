/**
 * /projects/[projectId]/history — Interview history (sitemap-workflow.md §7).
 *
 * One row per session. The header chart is the point: six data points is enough
 * to show a trend, and the trend is why people come back.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import AppHeader from '@/components/layout/AppHeader';
import ProjectHeader from '@/components/app/ProjectHeader';
import { Button, Card, Chip, EmptyState, SectionTitle, Skeleton } from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

interface SessionRow {
  id: string;
  seq: number;
  status: string;
  overall_score: number | null;
  duration_sec: number | null;
  created_at: string;
  config: { modules?: { coding?: boolean; system_design?: boolean; behavioral?: boolean } } | null;
}

interface ProjectShell {
  id: string;
  company_name: string;
  company_logo_url: string | null;
  role_title: string;
  seniority: string | null;
  status: string;
}

export default function HistoryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectShell | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: proj }, { data: rows }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, company_name, company_logo_url, role_title, seniority, status')
          .eq('id', projectId)
          .maybeSingle(),
        // db-design.md §6 "Interview History" — note config->modules rather than
        // the whole config blob.
        supabase
          .from('sessions')
          .select('id, seq, status, overall_score, duration_sec, created_at, config')
          .eq('project_id', projectId)
          .order('seq', { ascending: false }),
      ]);

      setProject(proj as ProjectShell | null);
      setSessions((rows as SessionRow[]) ?? []);
      setLoading(false);
    })();
  }, [projectId]);

  if (loading) {
    return (
      <Page>
        <Skeleton className="h-24 mb-6" />
        <Skeleton className="h-64" />
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

  const scored = [...sessions].filter((s) => s.overall_score != null).reverse();

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

      {sessions.length === 0 ? (
        <EmptyState
          heading="No interviews yet."
          body="Run one and this page becomes the record of how you're improving."
          action={<Button href={`/projects/${projectId}/interview/new`}>Start your first interview</Button>}
        />
      ) : (
        <>
          {scored.length >= 2 && (
            <Card className="p-6 mb-6">
              <SectionTitle>Score trend</SectionTitle>
              <TrendChart points={scored.map((s) => ({ seq: s.seq, score: s.overall_score! }))} />
            </Card>
          )}

          <Card className="p-6">
            <SectionTitle>All interviews</SectionTitle>
            <div className="space-y-3">
              {sessions.map((s, i) => {
                const previous = sessions[i + 1];
                const delta =
                  s.overall_score != null && previous?.overall_score != null
                    ? s.overall_score - previous.overall_score
                    : null;

                // In-flight sessions link to processing, not to a report that
                // does not exist yet (§7).
                const href =
                  s.status === 'complete'
                    ? `/sessions/${s.id}/report`
                    : s.status === 'abandoned'
                      ? `/projects/${projectId}/history`
                      : `/sessions/${s.id}/processing`;

                return (
                  <Link
                    key={s.id}
                    href={href}
                    className={`flex flex-wrap items-center justify-between gap-3 p-4 border-2 border-[#1B1F3B] rounded-2xl transition-colors ${
                      s.status === 'abandoned' ? 'opacity-50' : 'hover:bg-[#F5EBE0]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 shrink-0 bg-[#1B1F3B] text-white rounded-xl flex items-center justify-center font-[family-name:var(--font-display)] font-extrabold text-sm">
                        {s.seq}
                      </span>
                      <div className="min-w-0">
                        <p className="font-[family-name:var(--font-display)] font-bold text-sm truncate">
                          {new Date(s.created_at).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                        <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                          {s.duration_sec ? `${Math.round(s.duration_sec / 60)} min` : '—'} · {s.status}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {s.config?.modules?.coding && <Chip accent="sky">Coding</Chip>}
                      {s.config?.modules?.system_design && <Chip accent="yellow">System design</Chip>}

                      {s.overall_score != null && (
                        <div className="flex items-baseline gap-2">
                          <span className="font-[family-name:var(--font-display)] text-xl font-extrabold tabular-nums">
                            {s.overall_score.toFixed(1)}
                          </span>
                          {delta !== null && Math.abs(delta) >= 0.1 && (
                            <span
                              className={`font-[family-name:var(--font-mono)] text-xs font-bold tabular-nums ${
                                delta > 0 ? 'text-[#0d9488]' : 'text-[#FF5C7A]'
                              }`}
                            >
                              {delta > 0 ? '+' : ''}
                              {delta.toFixed(1)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}

/** Inline SVG line chart — no chart library for six points. */
function TrendChart({ points }: { points: Array<{ seq: number; score: number }> }) {
  const w = 640;
  const h = 160;
  const pad = 24;

  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
  const y = (score: number) => h - pad - (score / 10) * (h - pad * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.score)}`).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[420px]" role="img" aria-label="Score by interview">
        {[0, 5, 10].map((tick) => (
          <g key={tick}>
            <line x1={pad} y1={y(tick)} x2={w - pad} y2={y(tick)} stroke="#1B1F3B" strokeOpacity={0.15} strokeWidth={2} />
            <text x={4} y={y(tick) + 4} className="fill-[#1B1F3B]" fontSize={10} opacity={0.5}>
              {tick}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke="#FF6B35" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <g key={p.seq}>
            <circle cx={x(i)} cy={y(p.score)} r={7} fill="#FFF8F0" stroke="#1B1F3B" strokeWidth={3} />
            <text x={x(i)} y={h - 4} textAnchor="middle" fontSize={10} className="fill-[#1B1F3B]" opacity={0.6}>
              #{p.seq}
            </text>
          </g>
        ))}
      </svg>
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
