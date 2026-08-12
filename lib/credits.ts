/**
 * Credit pricing, interview length, and session billing.
 *
 * One place, because the number quoted on the setup screen, the gate that lets
 * an interview start, and the amount finally charged must never be able to
 * drift apart.
 *
 * ── How an interview is paid for ─────────────────────────────────────────────
 * Two different things, billed two different ways:
 *
 *   Modules (coding, system design)  — charged UPFRONT, flat.
 *     They are generated during preparation, before a word is spoken. The AI
 *     spend is already incurred by the time the interview starts, so there is
 *     nothing to pro-rate.
 *
 *   Voice time                       — charged AFTERWARDS, per minute.
 *     Nothing is held. Someone who ends after four minutes pays for four
 *     minutes. This is the friendlier model, but it means the balance is not
 *     protected during the interview — so `planSession` computes a hard ceiling
 *     from what the user can actually afford, and the interview stops there.
 *
 * ── How long an interview runs ───────────────────────────────────────────────
 * There is no duration picker. Length follows difficulty, because the two are
 * not independent: a hard interview needs room to go deep, and an easy one
 * padded to thirty minutes just repeats itself.
 */

export const CREDITS_PER_MINUTE = 5;
export const CODING_MODULE_CREDITS = 20;
export const SYSTEM_DESIGN_MODULE_CREDITS = 30;

/** No interview may carry more than three of either challenge type. */
export const MAX_MODULE_QUESTIONS = 3;

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DurationBand {
  /** The interview is planned to run at least this long. Also the credit gate. */
  min: number;
  /** Hard stop. The orchestrator ends the interview here regardless. */
  max: number;
}

export const DIFFICULTY_BANDS: Record<Difficulty, DurationBand> = {
  easy: { min: 10, max: 15 },
  medium: { min: 15, max: 20 },
  hard: { min: 20, max: 30 },
};

export interface SessionModules {
  coding: boolean;
  system_design: boolean;
}

// ── Planning a session ───────────────────────────────────────────────────────

export function moduleCredits(modules: SessionModules): number {
  return (
    (modules.coding ? CODING_MODULE_CREDITS : 0) +
    (modules.system_design ? SYSTEM_DESIGN_MODULE_CREDITS : 0)
  );
}

/**
 * The voice credits a difficulty requires before it may start: the band's floor
 * at the per-minute rate. 50 for easy, 75 for medium, 100 for hard.
 *
 * This is a floor, not a charge. Someone who ends after three minutes still
 * pays for three — but they must be able to afford the full planned interview
 * before starting one, or the interview would be cut short by their balance
 * rather than by the plan.
 */
export function minimumVoiceCredits(difficulty: Difficulty): number {
  return DIFFICULTY_BANDS[difficulty].min * CREDITS_PER_MINUTE;
}

export interface SessionPlan {
  difficulty: Difficulty;
  /** The band this difficulty targets. */
  band: DurationBand;
  /**
   * How long this interview may actually run. The band's max, unless the
   * balance affords less — in which case the interview hard-stops earlier
   * rather than running up a debt.
   */
  ceilingMinutes: number;
  /** True when the balance, not the difficulty, set the ceiling. */
  ceilingLimitedByCredits: boolean;

  /** Charged before the interview starts. */
  upfrontCredits: number;
  /** Voice credits needed on top of the upfront charge to be allowed to start. */
  minimumVoiceCredits: number;
  /** upfront + minimum voice. The number the balance is checked against. */
  requiredToStart: number;

  /** Whole minutes of voice the remaining balance can pay for. */
  affordableMinutes: number;
  /** The most this session can cost, if it runs to its ceiling. */
  maxTotalCredits: number;

  canStart: boolean;
  shortfall: number;
}

export function planSession(
  difficulty: Difficulty,
  modules: SessionModules,
  balance: number,
): SessionPlan {
  const band = DIFFICULTY_BANDS[difficulty];
  const upfront = moduleCredits(modules);
  const minVoice = minimumVoiceCredits(difficulty);
  const requiredToStart = upfront + minVoice;

  // Modules are paid first, so only what is left funds the conversation.
  const forVoice = Math.max(0, balance - upfront);
  const affordableMinutes = Math.floor(forVoice / CREDITS_PER_MINUTE);

  const ceilingMinutes = Math.min(band.max, Math.max(band.min, affordableMinutes));
  const canStart = balance >= requiredToStart;

  return {
    difficulty,
    band,
    ceilingMinutes,
    ceilingLimitedByCredits: canStart && affordableMinutes < band.max,
    upfrontCredits: upfront,
    minimumVoiceCredits: minVoice,
    requiredToStart,
    affordableMinutes,
    maxTotalCredits: upfront + ceilingMinutes * CREDITS_PER_MINUTE,
    canStart,
    shortfall: Math.max(0, requiredToStart - balance),
  };
}

// ── Settling voice time ──────────────────────────────────────────────────────

/**
 * Whole minutes to bill for.
 *
 * Part-minutes round up — "five credits a minute" that rounded down would make
 * a 59-second interview free. Capped at the session's ceiling so the charge can
 * never exceed the maximum shown on the setup screen, and floored at one so a
 * connection that dropped instantly is not billed as nothing when the prep
 * spend already happened.
 */
export function billableMinutes(actualSeconds: number, ceilingMinutes: number): number {
  const raw = Math.ceil(Math.max(0, actualSeconds) / 60);
  return Math.min(Math.max(1, raw), Math.max(1, ceilingMinutes));
}

export function voiceCredits(minutes: number): number {
  return minutes * CREDITS_PER_MINUTE;
}

// ── Module question counts ───────────────────────────────────────────────────

/**
 * How many challenges a module contains. Flat fee, variable count — the price is
 * for the round, not per question.
 *
 * Difficulty sets the ambition; the interview's ceiling sets what physically
 * fits, and the lower of the two wins. Shipping three problems into an interview
 * that cannot reach them produces no signal and wastes the generation.
 */
export function codingQuestionCount(difficulty: Difficulty, ceilingMinutes: number): number {
  const byDifficulty = { easy: 1, medium: 2, hard: 3 }[difficulty];
  const byDuration = ceilingMinutes < 20 ? 1 : ceilingMinutes < 28 ? 2 : 3;
  return clampCount(Math.min(byDifficulty, byDuration));
}

/** System design scenarios are slower to work through, so they need more room. */
export function designQuestionCount(difficulty: Difficulty, ceilingMinutes: number): number {
  const byDifficulty = { easy: 1, medium: 1, hard: 2 }[difficulty];
  const byDuration = ceilingMinutes < 20 ? 1 : ceilingMinutes < 30 ? 2 : 3;
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
    tagline: 'One easy interview, with room to spare.',
  },
  {
    id: 'placement',
    name: 'Placement pack',
    credits: 250,
    priceInr: 249,
    tagline: 'Three interviews, or two with coding rounds.',
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
