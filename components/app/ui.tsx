/**
 * Shared app-shell primitives, built to design.md.
 *
 * The system in one line: ink is structure. Every meaningful surface has a 4px
 * Deep Navy border and a hard offset shadow with zero blur. No gradients, no
 * glassmorphism, no soft shadows anywhere.
 */

'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export const INK = '#1B1F3B';
export const PAPER = '#FFF8F0';

/** design.md §2.2 — one accent per viewport, and these are the only five. */
export const ACCENT = {
  orange: '#FF6B35',
  sky: '#4EA8FF',
  yellow: '#FFC93C',
  mint: '#6EE7B7',
  coral: '#FF5C7A',
} as const;

export type AccentName = keyof typeof ACCENT;

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
  tilt = 0,
  accent,
}: {
  children: ReactNode;
  className?: string;
  tilt?: number;
  accent?: AccentName;
}) {
  return (
    <div
      style={{
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        boxShadow: `6px 6px 0 ${accent ? ACCENT[accent] : INK}`,
      }}
      className={`bg-white border-4 border-[#1B1F3B] rounded-3xl ${className}`}
    >
      {children}
    </div>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-[#FF6B35] text-white',
  secondary: 'bg-white text-[#1B1F3B]',
  ghost: 'bg-transparent text-[#1B1F3B]',
  danger: 'bg-[#FF5C7A] text-white',
};

export function Button({
  children,
  onClick,
  href,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  // Lift on hover, press down on click — the tactile metaphor from design.md §6.
  const base =
    `inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border-4 border-[#1B1F3B] ` +
    `font-[family-name:var(--font-display)] font-bold text-sm shadow-[4px_4px_0_#1B1F3B] ` +
    `transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#1B1F3B] ` +
    `active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_#1B1F3B] ` +
    `disabled:opacity-40 disabled:pointer-events-none ${BUTTON_STYLES[variant]} ${className}`;

  if (href && !disabled) {
    return (
      <Link href={href} className={base} title={title}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={base} title={title}>
      {children}
    </button>
  );
}

// ── Chips & labels ───────────────────────────────────────────────────────────

export function Chip({
  children,
  accent,
  className = '',
}: {
  children: ReactNode;
  accent?: AccentName;
  className?: string;
}) {
  return (
    <span
      style={accent ? { backgroundColor: ACCENT[accent] } : undefined}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border-2 border-[#1B1F3B] ${
        accent ? '' : 'bg-white'
      } font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider text-[#1B1F3B] ${className}`}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em] text-[#1B1F3B]/60">
      {children}
    </p>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-extrabold text-[#1B1F3B]">
        {children}
      </h2>
      {sub && <p className="mt-1 text-sm text-[#1B1F3B]/70">{sub}</p>}
    </div>
  );
}

// ── Data display ─────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  accent = 'orange',
  hint,
}: {
  label: string;
  value: string | number;
  accent?: AccentName;
  hint?: string;
}) {
  return (
    <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl px-5 py-4 shadow-[4px_4px_0_#1B1F3B]">
      <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.18em] text-[#1B1F3B]/60">
        {label}
      </p>
      {/* tabular-nums so a count-up never shifts the layout */}
      <p
        style={{ color: ACCENT[accent] }}
        className="font-[family-name:var(--font-display)] text-3xl font-extrabold tabular-nums mt-1"
      >
        {value}
      </p>
      {hint && <p className="text-xs text-[#1B1F3B]/60 mt-0.5">{hint}</p>}
    </div>
  );
}

/** 0–10 score bar. Colour follows the band, so the shape carries meaning. */
export function ScoreBar({
  label,
  score,
  max = 10,
}: {
  label: string;
  score: number | null | undefined;
  max?: number;
}) {
  const pct = score == null ? 0 : Math.min(100, (score / max) * 100);
  const accent: AccentName = score == null ? 'sky' : score >= 7 ? 'mint' : score >= 5 ? 'yellow' : 'coral';

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-[family-name:var(--font-display)] text-sm font-bold text-[#1B1F3B]">{label}</span>
        <span className="font-[family-name:var(--font-mono)] text-sm font-bold tabular-nums text-[#1B1F3B]">
          {score == null ? '—' : score.toFixed(1)}
        </span>
      </div>
      <div className="h-4 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-full overflow-hidden">
        <div
          style={{ width: `${pct}%`, backgroundColor: ACCENT[accent] }}
          className="h-full transition-all duration-700"
        />
      </div>
    </div>
  );
}

/**
 * Readiness ring. The focal number on a project tile — readiness is the thing
 * that changes because you practised; a single interview score is noise.
 */
export function ReadinessRing({ value, size = 96 }: { value: number | null; size?: number }) {
  const pct = value ?? 0;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const accent: AccentName = pct >= 70 ? 'mint' : pct >= 45 ? 'yellow' : 'coral';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F5EBE0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={value == null ? '#F5EBE0' : ACCENT[accent]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (pct / 100) * circumference}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-[family-name:var(--font-display)] text-xl font-extrabold tabular-nums text-[#1B1F3B]">
          {value == null ? '—' : pct}
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[8px] font-bold uppercase tracking-wider text-[#1B1F3B]/50">
          Ready
        </span>
      </div>
    </div>
  );
}

// ── States ───────────────────────────────────────────────────────────────────

/**
 * design.md / sitemap §16: every empty state gets a heading, one line of
 * context, and exactly one action. Never a bare "No data".
 */
export function EmptyState({
  heading,
  body,
  action,
  secondary,
}: {
  heading: string;
  body: string;
  action?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <Card className="p-8 md:p-12 text-center">
      <h3 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-extrabold text-[#1B1F3B]">
        {heading}
      </h3>
      <p className="mt-2 text-sm text-[#1B1F3B]/70 max-w-md mx-auto">{body}</p>
      {action && <div className="mt-6 flex flex-wrap gap-3 justify-center">{action}</div>}
      {secondary && <div className="mt-3">{secondary}</div>}
    </Card>
  );
}

/**
 * Skeletons at true component dimensions. Never a centred spinner — layout
 * shift on a grid is worse than a slightly longer wait (sitemap §16).
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-[#F5EBE0] border-4 border-[#1B1F3B]/20 rounded-3xl animate-pulse ${className}`} />;
}

/**
 * Errors say what failed, whether anything was lost, whether credits were
 * affected, and what to do next.
 */
export function ErrorCard({
  heading,
  body,
  action,
}: {
  heading: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-[#FF5C7A]/10 border-4 border-[#1B1F3B] rounded-3xl p-6 shadow-[6px_6px_0_#FF5C7A]">
      <h3 className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B]">{heading}</h3>
      <p className="mt-1.5 text-sm text-[#1B1F3B]/80">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Named stages, never a percentage — people tolerate "Reading the company site…" far better. */
export function StageList({
  stages,
  current,
}: {
  stages: string[];
  current: number;
}) {
  return (
    <ol className="space-y-3">
      {stages.map((stage, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={stage} className="flex items-center gap-3">
            <span
              className={`w-7 h-7 shrink-0 rounded-full border-2 border-[#1B1F3B] flex items-center justify-center font-[family-name:var(--font-mono)] text-xs font-bold ${
                done ? 'bg-[#6EE7B7]' : active ? 'bg-[#FFC93C] animate-pulse' : 'bg-white'
              }`}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className={`text-sm ${
                done ? 'text-[#1B1F3B]/50 line-through' : active ? 'font-bold text-[#1B1F3B]' : 'text-[#1B1F3B]/50'
              }`}
            >
              {stage}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Skill status chip colours, fixed by sitemap §7. */
export function SkillStatusChip({ status }: { status: string | null }) {
  const map: Record<string, AccentName> = {
    STRONG: 'mint',
    WEAK: 'yellow',
    UNVERIFIED: 'sky',
    MISSING: 'coral',
    SURPLUS: 'sky',
  };
  const accent = status ? map[status] : undefined;
  return <Chip accent={accent}>{status ?? 'NOT MEASURED'}</Chip>;
}
