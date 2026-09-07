/**
 * The preparation window — everything about the calendar between today and the
 * interview, computed in code.
 *
 * ── Why the model is not allowed near a date ─────────────────────────────────
 * A study plan is a document someone acts on. If it says "Thursday 12th" and the
 * 12th is a Tuesday, or it plans eleven days into a nine-day window, the whole
 * artifact is discredited — including the parts that were right. Models are
 * reliably bad at exactly this: counting days, respecting a window, keeping
 * weekday and date consistent.
 *
 * So the split is the same one S1 and E4 use elsewhere in this codebase. Code
 * decides WHEN — how many days there are, which dates they fall on, whether
 * there is enough time at all. The model decides WHAT goes in each slot, and
 * addresses slots by integer offset. A day offset cannot be a date that does not
 * exist, and an offset outside the window is dropped here rather than shown to
 * someone as a day they should have been studying.
 */

import type { GapReport } from '../agents/schemas';

/**
 * The furthest ahead a detailed day-by-day plan is worth writing.
 *
 * Beyond about six weeks a dated schedule is fiction — people's lives move, and
 * a plan that allocates day 71 will be wrong by the time day 71 arrives. Someone
 * interviewing in four months gets the last six weeks planned properly and is
 * told plainly that the time before that is theirs.
 */
export const PLAN_HORIZON_DAYS = 42;

/**
 * How much time there is, in the only terms that matter to the plan's shape.
 *
 * `crash` is not a smaller `comfortable`. It is a different plan — triage, not
 * compression — and the prompt branches on this rather than being asked to
 * infer urgency from a number.
 */
export type PrepPressure = 'past' | 'crash' | 'tight' | 'comfortable';

export interface PrepDay {
  /** What the model addresses this day by. Never a date. */
  offset: number;
  /** ISO YYYY-MM-DD. Authoritative — resolved here, never taken from a model. */
  date: string;
  /** 'Mon', 'Tue'… so the plan can respect the shape of someone's week. */
  weekday: string;
  isWeekend: boolean;
}

export interface PrepWindow {
  /** ISO date of the interview. */
  interviewDate: string;
  /** Whole calendar days from today until the interview. Negative if past. */
  daysUntil: number;
  pressure: PrepPressure;
  /** Days actually planned in detail — `daysUntil`, capped at the horizon. */
  planDays: number;
  /** Days before the detailed plan starts, when the interview is far out. */
  leadDays: number;
  /** One entry per planned day, offset 0 first. */
  days: PrepDay[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MS_PER_DAY = 86_400_000;

/**
 * A date-only string as a timestamp at UTC noon.
 *
 * Noon, not midnight, and UTC, not local. Two bugs are being avoided at once: a
 * midnight anchor lands on the missing hour in a DST transition and shifts the
 * whole diff by a day, and a local-midnight anchor makes "days until" depend on
 * what time of day the user opened the page. Anchoring both ends at UTC noon
 * makes the difference exactly the number of calendar days between them, for
 * every timezone and across every DST boundary.
 */
function utcNoon(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

/** Today in the VIEWER's calendar, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(iso: string, days: number): string {
  return new Date(utcNoon(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** True for a well-formed calendar date, false for "2026-02-31" or nonsense. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ts = utcNoon(value);
  return Number.isFinite(ts) && new Date(ts).toISOString().slice(0, 10) === value;
}

export function computePrepWindow(interviewDate: string, today = todayIso()): PrepWindow {
  const daysUntil = Math.round((utcNoon(interviewDate) - utcNoon(today)) / MS_PER_DAY);

  const pressure: PrepPressure =
    daysUntil < 0 ? 'past' : daysUntil <= 2 ? 'crash' : daysUntil <= 9 ? 'tight' : 'comfortable';

  const planDays = Math.max(0, Math.min(daysUntil, PLAN_HORIZON_DAYS));
  const leadDays = Math.max(0, daysUntil - PLAN_HORIZON_DAYS);

  /*
   * The plan ENDS the day before the interview and counts backwards, rather
   * than starting today and running forwards.
   *
   * For any window inside the horizon these are the same thing. For a longer
   * one they are not, and the difference matters: the six weeks immediately
   * before the interview are the six weeks worth planning, not the six weeks
   * immediately after someone happened to create the project.
   */
  const planStart = addDays(interviewDate, -planDays);

  const days: PrepDay[] = Array.from({ length: planDays }, (_, offset) => {
    const date = addDays(planStart, offset);
    const dow = new Date(utcNoon(date)).getUTCDay();
    return { offset, date, weekday: WEEKDAYS[dow], isWeekend: dow === 0 || dow === 6 };
  });

  return { interviewDate, daysUntil, pressure, planDays, leadDays, days };
}

/**
 * A compact calendar for the prompt: one short line per day.
 *
 * The model needs weekdays — nobody does four hours of deep work on a Wednesday
 * evening the way they can on a Saturday — but giving it dates it could echo
 * back would defeat the point. It sees the shape of the week and answers in
 * offsets.
 */
export function describeCalendar(window: PrepWindow): string {
  return window.days
    .map((d) => `day ${d.offset}: ${d.weekday}${d.isWeekend ? ' (weekend)' : ''}`)
    .join('\n');
}

export interface ScheduledBlock {
  offset: number;
  date: string;
  weekday: string;
  isWeekend: boolean;
  focus: string;
  kind: string;
  tasks: string[];
  estHours: number;
}

/**
 * Turns the model's day offsets into real dates, and throws away anything that
 * does not belong.
 *
 * Three things are enforced here rather than asked for: an offset must be inside
 * the window, each day may appear once, and the result is in date order. Every
 * one of those is something a model gets wrong occasionally — a duplicate day 3,
 * an offset past the interview — and every one of them, left in, produces a
 * schedule that visibly does not add up.
 */
export function resolveBlocks(
  window: PrepWindow,
  blocks: Array<{ day_offset: number; focus: string; kind: string; tasks: string[]; est_hours: number }>,
): ScheduledBlock[] {
  const byOffset = new Map(window.days.map((d) => [d.offset, d]));
  const taken = new Set<number>();
  const out: ScheduledBlock[] = [];

  for (const block of blocks) {
    const day = byOffset.get(block.day_offset);
    if (!day || taken.has(day.offset)) continue;
    taken.add(day.offset);

    out.push({
      offset: day.offset,
      date: day.date,
      weekday: day.weekday,
      isWeekend: day.isWeekend,
      focus: block.focus,
      kind: block.kind,
      tasks: block.tasks,
      estHours: block.est_hours,
    });
  }

  return out.sort((a, b) => a.offset - b.offset);
}

// ── What the resume cannot show ──────────────────────────────────────────────

export interface UnevidencedSkill {
  skill: string;
  importance: number;
  /** What the resume currently offers for it, from P4. */
  evidence: string;
  status: string;
}

/**
 * The skills this role needs that the resume does not demonstrate through work.
 *
 * `listed_only` is the interesting case and the reason this is not just a check
 * for missing skills: a skill sitting in a comma-separated list at the bottom of
 * a resume is a claim with nothing behind it. An interviewer discounts it, an
 * ATS counts it, and the candidate believes it is covered. Those are exactly the
 * skills a portfolio project should be built for.
 *
 * Decided here rather than by the model so the recommendation is grounded in
 * P4's actual analysis instead of a second opinion about the same resume.
 */
// ── Is the target resume true yet? ───────────────────────────────────────────

export type PreconditionState = 'met' | 'progressing' | 'unmet';

export interface PreconditionStatus {
  skill: string;
  state: PreconditionState;
  /** What the interviews actually found, in words. */
  detail: string;
}

export interface TargetReadiness {
  statuses: PreconditionStatus[];
  met: number;
  total: number;
  /** True only when every precondition has been verified STRONG. */
  allMet: boolean;
}

/**
 * Checks the target resume's preconditions against what the mock interviews have
 * actually established.
 *
 * ── Why this runs on every page view rather than at generation time ─────────
 * The whole point of the target resume is that it becomes true. A warning
 * computed once, when the plan was generated, would still be telling someone
 * their Kubernetes claim is unearned three weeks and four interviews after they
 * proved it — and a warning that is visibly stale is a warning people learn to
 * dismiss.
 *
 * So the preconditions are stored and the verdict is not. As skills verify
 * STRONG the count goes up on its own, and when the last one lands the banner
 * changes from "do not send this" to "this is now yours".
 *
 * The bar is STRONG specifically. `skill_progress` marks a skill WEAK when it
 * was established but answered poorly, and treating that as met would clear the
 * warning on the strength of an interview that went badly.
 */
export function evaluatePreconditions(
  preconditions: Array<{ skill: string }>,
  verified: Array<{ skill: string; status: string | null; score: number | null }>,
): TargetReadiness {
  const norm = (s: string) => s.trim().toLowerCase();
  const bySkill = new Map(verified.map((v) => [norm(v.skill), v]));

  const statuses = preconditions.map<PreconditionStatus>((p) => {
    /*
     * Exact match first, then a containment fallback.
     *
     * The model is told to spell the skill exactly as the gap report does, and
     * mostly it does — but "Kubernetes" against a stored "Kubernetes (K8s)"
     * would otherwise read as never tested, and the candidate would be told to
     * go and prove something they had already proved.
     */
    const exact = bySkill.get(norm(p.skill));
    const loose =
      exact ??
      verified.find(
        (v) => norm(v.skill).includes(norm(p.skill)) || norm(p.skill).includes(norm(v.skill)),
      );

    if (!loose || loose.status === 'UNVERIFIED' || loose.status === null) {
      return {
        skill: p.skill,
        state: 'unmet',
        detail: 'Not yet established in a mock interview.',
      };
    }

    if (loose.status === 'STRONG') {
      return {
        skill: p.skill,
        state: 'met',
        detail: `Verified strong${loose.score !== null ? ` at ${loose.score}/10` : ''}.`,
      };
    }

    return {
      skill: p.skill,
      state: 'progressing',
      detail: `Established but not yet strong${loose.score !== null ? ` — ${loose.score}/10` : ''}.`,
    };
  });

  const met = statuses.filter((s) => s.state === 'met').length;

  return {
    statuses,
    met,
    total: statuses.length,
    // An empty precondition list is NOT "all met". A target resume with nothing
    // to prove is a generation that went wrong, and reading it as ready would
    // clear the warning on the strength of a missing field.
    allMet: statuses.length > 0 && met === statuses.length,
  };
}

export function skillsWithoutProjectEvidence(gap: GapReport, limit = 6): UnevidencedSkill[] {
  return gap.skills
    .filter(
      (s) =>
        s.jd_importance >= 0.5 &&
        (s.resume_evidence === 'none' || s.resume_evidence === 'listed_only') &&
        s.status !== 'SURPLUS',
    )
    .sort((a, b) => b.jd_importance - a.jd_importance || b.investigation_priority - a.investigation_priority)
    .slice(0, limit)
    .map((s) => ({
      skill: s.skill,
      importance: s.jd_importance,
      evidence: s.resume_evidence,
      status: s.status,
    }));
}
