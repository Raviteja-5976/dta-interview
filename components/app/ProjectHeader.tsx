/**
 * The project header, persistent across every project tab (sitemap §6).
 *
 * Tabs are real routes, not client state: deep-linkable, browser-back works, and
 * per db-design.md §6 each tab fetches exactly one JSONB column — so tab-as-route
 * is also the cheapest data pattern.
 *
 * `Start interview` appears here and on the Overview, and nowhere else. An action
 * that can be fired from anywhere gets fired accidentally, and this one spends a
 * credit.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Play } from 'lucide-react';

import { Button, Chip } from './ui';

const TABS = [
  { slug: '', label: 'Overview' },
  { slug: 'gaps', label: 'Gap analysis' },
  // Sits after the gaps it is built from and before the interview history, in
  // the order someone actually moves through them: see the gap, plan for it,
  // then look at how the practice went.
  { slug: 'plan', label: 'Prep plan' },
  { slug: 'history', label: 'History' },
];

export interface ProjectHeaderProps {
  projectId: string;
  companyName: string;
  companyLogoUrl?: string | null;
  roleTitle: string;
  seniority?: string | null;
  status: string;
  /** Why Start is disabled, shown rather than hidden (§6). */
  startDisabledReason?: string;
}

export default function ProjectHeader({
  projectId,
  companyName,
  companyLogoUrl,
  roleTitle,
  seniority,
  status,
  startDisabledReason,
}: ProjectHeaderProps) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 shrink-0 bg-white border-4 border-[#1B1F3B] rounded-2xl shadow-[3px_3px_0_#1B1F3B] flex items-center justify-center overflow-hidden">
            {companyLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={companyLogoUrl} alt="" className="w-full h-full object-contain p-1" />
            ) : (
              <Building2 className="w-6 h-6 text-[#1B1F3B]" />
            )}
          </div>

          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-4xl font-extrabold text-[#1B1F3B] leading-tight">
              {companyName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-sm font-medium text-[#1B1F3B]/80">{roleTitle}</span>
              {seniority && <Chip>{seniority}</Chip>}
              {status !== 'ready' && (
                <Chip accent={status === 'failed' ? 'coral' : 'yellow'}>
                  {status === 'preparing' ? 'Preparing…' : status}
                </Chip>
              )}
            </div>
          </div>
        </div>

        <Button
          href={startDisabledReason ? undefined : `${base}/interview/new`}
          disabled={Boolean(startDisabledReason)}
          title={startDisabledReason}
        >
          <Play className="w-4 h-4" /> Start interview
        </Button>
      </div>

      {startDisabledReason && (
        <p className="mt-2 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
          {startDisabledReason}
        </p>
      )}

      <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const active = pathname === href;
          return (
            <Link
              key={tab.label}
              href={href}
              className={`shrink-0 px-4 py-2 rounded-2xl border-4 border-[#1B1F3B] font-[family-name:var(--font-display)] text-sm font-bold transition-all ${
                active
                  ? 'bg-[#1B1F3B] text-white shadow-[3px_3px_0_#FF6B35]'
                  : 'bg-white text-[#1B1F3B] shadow-[3px_3px_0_#1B1F3B] hover:-translate-y-0.5'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
