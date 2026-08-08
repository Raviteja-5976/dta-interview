/**
 * Credit pricing and session billing.
 *
 * One place, because the number quoted on the setup screen, the number held when
 * the interview starts, and the number finally charged must never be able to
 * drift apart.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 * Interviews are metered: 5 credits per minute, for however long the interview
 * actually runs. Modules are flat add-ons.
 *
 * That means the final cost is not knowable at the start, so billing runs in two
 * steps:
 *
 *   1. HOLD  — at session start we charge the maximum the session could cost
 *              (the full planned duration plus every enabled module). This is a
 *              real debit, so a user can never start an interview they cannot
 *              pay for.
 *   2. SETTLE — when the interview ends we compute what it actually cost and
 *              refund the difference.
 *
 * The settled amount can never exceed the hold, so the number on the setup
 * screen is a ceiling the user agreed to, never a surprise.
 */

export const CREDITS_PER_MINUTE = 5;
export const CODING_MODULE_CREDITS = 20;
export const SYSTEM_DESIGN_MODULE_CREDITS = 30;

/** No interview may carry more than three of either challenge type. */
export const MAX_MODULE_QUESTIONS = 3;

export interface SessionModules {
  coding: boolean;
  system_design: boolean;
}

export interface CreditQuote {
  /** Minutes used for the quote. */
  minutes: number;
  voice: number;
  coding: number;
  system_design: number;
  total: number;
  lines: Array<{ label: string; credits: number; note?: string }>;
}

/**
 * The hold: the most this session can possibly cost. Quoted on the setup screen
 * and debited at start.
 */
export function quoteSession(durationMin: number, modules: SessionModules): CreditQuote {
  const minutes = Math.max(1, Math.round(durationMin));
  const voice = minutes * CREDITS_PER_MINUTE;
  const coding = modules.coding ? CODING_MODULE_CREDITS : 0;
  const systemDesign = modules.system_design ? SYSTEM_DESIGN_MODULE_CREDITS : 0;

  return {
    minutes,
    voice,
    coding,
    system_design: systemDesign,
    total: voice + coding + systemDesign,
    lines: [
      {
        label: `Interview · up to ${minutes} min`,
        credits: voice,
        note: `${CREDITS_PER_MINUTE} credits per minute`,
      },
      {
        label: 'Coding round',
        credits: coding,
        note: modules.coding ? `${codingQuestionCount('medium', durationMin)}-question round` : undefined,
      },
      { label: 'System design', credits: systemDesign },
    ],
  };
}

export interface SettlementInput {
  /** How long the interview actually ran. */
  actualSeconds: number;
  /** The duration the hold was quoted against. The settlement cannot exceed it. */
  plannedMinutes: number;
  /** Whether a coding question was actually asked. */
  codingDelivered: boolean;
  /** Whether a system design question was actually asked. */
  designDelivered: boolean;
}

export interface Settlement {
  billedMinutes: number;
  voice: number;
  coding: number;
  system_design: number;
  total: number;
}

/**
 * What the session actually cost.
 *
 * Two deliberate choices:
 *   · Part-minutes round up — "per minute" billing that rounded down would let a
 *     59-second interview run free.
 *   · Modules are only charged if they were actually delivered. Someone who
 *     ended the interview before the coding round never got a coding round, and
 *     charging 20 credits for it would be indefensible.
 */
export function settleSession(input: SettlementInput): Settlement {
  const rawMinutes = Math.ceil(Math.max(0, input.actualSeconds) / 60);
  const billedMinutes = Math.min(Math.max(1, rawMinutes), Math.max(1, input.plannedMinutes));

  const voice = billedMinutes * CREDITS_PER_MINUTE;
  const coding = input.codingDelivered ? CODING_MODULE_CREDITS : 0;
  const systemDesign = input.designDelivered ? SYSTEM_DESIGN_MODULE_CREDITS : 0;

  return {
    billedMinutes,
    voice,
    coding,
    system_design: systemDesign,
    total: voice + coding + systemDesign,
  };
}

// ── Module question counts ───────────────────────────────────────────────────

type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * How many challenges a module contains. Flat fee, variable count — the price is
 * for the round, not per question.
 *
 * Two ceilings apply and the lower wins. Difficulty sets the ambition; duration
 * sets what physically fits. A 15-minute interview cannot hold three coding
 * problems no matter how hard the setting is, and shipping one the candidate
 * cannot finish produces no signal.
 */
export function codingQuestionCount(difficulty: Difficulty, durationMin: number): number {
  const byDifficulty = { easy: 1, medium: 2, hard: 3 }[difficulty];
  const byDuration = durationMin < 20 ? 1 : durationMin < 45 ? 2 : 3;
  return clampCount(Math.min(byDifficulty, byDuration));
}

/** System design questions are slower to work through, so they need more room. */
export function designQuestionCount(difficulty: Difficulty, durationMin: number): number {
  const byDifficulty = { easy: 1, medium: 1, hard: 2 }[difficulty];
  const byDuration = durationMin < 30 ? 1 : durationMin < 60 ? 2 : 3;
  return clampCount(Math.min(byDifficulty, byDuration));
}

function clampCount(n: number): number {
  return Math.max(1, Math.min(MAX_MODULE_QUESTIONS, n));
}

// ── Packs ────────────────────────────────────────────────────────────────────

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  /** Rupees. Razorpay wants paise, so multiply at the boundary — never before. */
  priceInr: number;
  tagline: string;
  popular?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: 'starter',
    name: 'Starter',
    credits: 100,
    priceInr: 119,
    tagline: 'About one 20-minute interview.',
  },
  {
    id: 'placement',
    name: 'Placement pack',
    credits: 250,
    priceInr: 249,
    tagline: 'Three interviews with coding rounds.',
    popular: true,
  },
  {
    id: 'season',
    name: 'Season pass',
    credits: 600,
    priceInr: 499,
    tagline: 'A full placement season.',
  },
];

export function findPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/** Razorpay works in paise. This is the only place the conversion happens. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** For the "₹X per interview" line on the pricing page. */
export function creditsToRupees(pack: CreditPack): number {
  return pack.priceInr / pack.credits;
}

/** A worked example, so "5 credits a minute" means something concrete. */
export function describeExample(durationMin: number, modules: SessionModules): string {
  const q = quoteSession(durationMin, modules);
  const parts = [`${durationMin} min`];
  if (modules.coding) parts.push('coding');
  if (modules.system_design) parts.push('system design');
  return `${parts.join(' + ')} = ${q.total} credits`;
}
