/**
 * §4 · Natural conversation rules — R1 through R11.
 *
 * Design decision D8: these are constraints, not judgements. They must hold on
 * turn 25 exactly as firmly as on turn 3, and every one is cheaper to check than
 * to reason about. So they run in code, never in a prompt (invariant 11).
 *
 * They execute twice per turn:
 *   `legalActions()`   — pre-filter, strips illegal actions before L1 is called
 *   `validateIntent()` — post-validator, rejects an illegal intent for resampling
 *
 * Capping the shortlist at 8 is a latency decision as much as a quality one:
 * L1's prompt stays small and near-constant in size however deep into the
 * interview it is.
 */

import type { Blueprint, ConversationalIntent, UtterancePlan } from '../agents/schemas';
import {
  NO_FLOOR_SECTIONS,
  SECTION_QUESTION_BUDGET,
  type Coverage,
  type CandidateAction,
  type EntryStyle,
  type SessionRuntime,
} from './types';
import type { MemoryItem } from './l2-memory-store';

const SHORTLIST_MAX = 8;

/** R5: permitted acknowledgements are neutral. Never evaluative. */
export const ACKNOWLEDGEMENT_POOL = [
  'Got it.',
  'Okay.',
  'That makes sense.',
  'Right.',
  'Mm-hm.',
  'Understood.',
  'Okay, thanks.',
  'Sure.',
];

/**
 * R5 again, and it is a data-integrity rule wearing a politeness costume:
 * evaluative feedback mid-interview changes how the candidate performs for the
 * remaining turns, which corrupts the evidence the report is built on.
 */
const FORBIDDEN_ACK_PATTERNS = [
  /\bgreat\b/i, /\bperfect\b/i, /\bexcellent\b/i, /\bexactly\b/i, /\bwell done\b/i,
  /\bgood (answer|job|point)\b/i, /\bnot quite\b/i, /\bwrong\b/i, /\bnice\b/i,
  /\bimpressive\b/i, /\bbrilliant\b/i, /\bthat's right\b/i, /\bincorrect\b/i,
];

export interface RuleInput {
  blueprint: Blueprint;
  coverage: Coverage;
  runtime: SessionRuntime;
  memory: MemoryItem[];
  /** The question just answered, for R1's similarity check. */
  lastQuestion?: { skill_tags: string[]; entry_style?: EntryStyle; text: string };
  /** Duration of the last answer in seconds, for R8. */
  lastAnswerSec?: number;
  /** Whether the last answer produced no new evidence. */
  lastAnswerWeak?: boolean;
  /** Set when the candidate made a major factual error, for R7. */
  majorErrorPresent?: boolean;
  /** Seconds elapsed in the current section, for section ceilings. */
  sectionElapsedSec?: number;
  /** Drives R12's per-section question budget. */
  difficulty?: 'easy' | 'medium' | 'hard';
}

// ── Enumeration ──────────────────────────────────────────────────────────────

/** Every structurally possible action, before any rule has run. */
export function enumerateActions(input: RuleInput): CandidateAction[] {
  const { blueprint, coverage, runtime, memory } = input;
  const actions: CandidateAction[] = [];

  const section = blueprint.sections.find((s) => s.section_id === runtime.current_section_id);
  if (!section) return actions;

  for (const goal of section.goals) {
    const state = coverage.goals.find((g) => g.goal_id === goal.goal_id);
    if (!state || state.status === 'satisfied' || state.status === 'abandoned') continue;

    const isActive = runtime.active_goal_id === goal.goal_id;

    // Follow-ups: only for the active goal, and only for evidence still missing.
    if (isActive) {
      for (const fu of goal.followup_bank) {
        if (runtime.asked_followup_ids.includes(fu.followup_id)) continue;
        if (!state.outstanding.includes(fu.for_evidence)) continue;

        actions.push({
          action: 'PROBE_EVIDENCE',
          goal_id: goal.goal_id,
          section_id: section.section_id,
          skill_tags: goal.skill_tags,
          source_kind: 'followup_bank',
          source_id: fu.followup_id,
          text: fu.text,
          targets_evidence: [fu.for_evidence],
          difficulty: runtime.current_difficulty,
          entry_style: 'direct',
          priority: 0.7,
        });
      }
    }

    for (const q of goal.question_bank) {
      if (runtime.asked_bank_ids.includes(q.bank_id)) continue;

      actions.push({
        action: isActive ? 'PROBE_EVIDENCE' : 'NEW_GOAL_QUESTION',
        goal_id: goal.goal_id,
        section_id: section.section_id,
        skill_tags: goal.skill_tags,
        source_kind: 'bank',
        source_id: q.bank_id,
        text: q.text,
        targets_evidence: q.targets_evidence,
        difficulty: q.difficulty,
        entry_style: q.entry_style,
        grading_mode: q.grading_mode,
        priority: isActive ? 0.6 : goal.priority * 0.8,
      });
    }
  }

  // Callbacks, from open memory items.
  for (const item of memory) {
    if (item.spent) continue;
    for (const cb of item.callback_candidates) {
      actions.push({
        action: 'CALLBACK',
        goal_id: cb.best_for_goal || runtime.active_goal_id || undefined,
        section_id: section.section_id,
        skill_tags: item.related_skills,
        source_kind: 'callback',
        source_id: item.item_id,
        text: cb.text,
        targets_evidence: [],
        difficulty: runtime.current_difficulty,
        entry_style: 'direct',
        priority: cb.value * 0.5,
      });
    }
  }

  // Structural moves are always on the table.
  if (runtime.active_goal_id) {
    actions.push({
      action: 'CLOSE_GOAL',
      goal_id: runtime.active_goal_id,
      section_id: section.section_id,
      skill_tags: [],
      source_kind: 'none',
      targets_evidence: [],
      priority: 0.2,
    });
  }

  actions.push({
    action: 'TRANSITION_SECTION',
    section_id: section.section_id,
    skill_tags: [],
    source_kind: 'none',
    targets_evidence: [],
    priority: 0.15,
  });

  if (input.majorErrorPresent) {
    actions.push({
      action: 'CORRECT_AND_CONTINUE',
      goal_id: runtime.active_goal_id ?? undefined,
      section_id: section.section_id,
      skill_tags: [],
      source_kind: 'none',
      targets_evidence: [],
      priority: 0.5,
    });
  }

  if (input.lastAnswerWeak) {
    actions.push({
      action: 'REASSURE_AND_RETRY',
      goal_id: runtime.active_goal_id ?? undefined,
      section_id: section.section_id,
      skill_tags: [],
      source_kind: 'none',
      targets_evidence: [],
      priority: 0.55,
    });
  }

  return actions;
}

// ── The filter chain, in the order §4 specifies ──────────────────────────────

export function legalActions(input: RuleInput): CandidateAction[] {
  let candidates = enumerateActions(input);

  candidates = candidates.filter((c) => !violatesSimilarity(c, input)); // R1
  candidates = candidates.filter((c) => pivotAllowed(c, input));        // R2
  candidates = dropVerifiedTargets(candidates, input);                  // R11
  candidates = applyDifficultyBounds(candidates, input);                // R4
  candidates = applyRecoveryPolicy(candidates, input);                  // R9
  candidates = applyCorrectionBudget(candidates, input);                // R7
  candidates = applyRhythmPolicy(candidates, input);                    // R8
  candidates = boostCallbacks(candidates, input);                       // R3
  candidates = applyGradingModeVariety(candidates, input);              // R13
  candidates = applySectionBudget(candidates, input);                   // R12 — last word

  // Never return an empty set — L1 must always have something legal to choose.
  if (candidates.length === 0) {
    candidates = [
      {
        action: 'TRANSITION_SECTION',
        section_id: input.runtime.current_section_id,
        skill_tags: [],
        source_kind: 'none',
        targets_evidence: [],
        priority: 1,
      },
    ];
  }

  const sorted = candidates.sort((a, b) => b.priority - a.priority);
  const shortlist = sorted.slice(0, SHORTLIST_MAX);

  /*
   * The option to LEAVE always survives the cut.
   *
   * TRANSITION_SECTION carries the lowest priority in the whole enumeration
   * (0.15), and a section with two goals contributes a dozen bank questions
   * above it — so the top-8 slice dropped it every time. L1 could then only ever
   * leave a section by exhausting its question ceiling, which is precisely the
   * "it never switches sections" behaviour, and it would have made R12's floor
   * read as a fixed question count rather than a range.
   *
   * Below the floor this is a no-op: R12 has already removed the action from the
   * candidate set, so there is nothing to reinstate.
   */
  if (!shortlist.some((c) => c.action === 'TRANSITION_SECTION')) {
    const exit = sorted.find((c) => c.action === 'TRANSITION_SECTION');
    if (exit) shortlist[shortlist.length - 1] = exit;
  }

  return shortlist;
}

/**
 * R1 · No two similar questions consecutively.
 *
 * Note this bars similar-*shaped* questions, not staying on a topic. Probing the
 * same skill from a different angle is exactly what a good interviewer does;
 * asking the same question twice in different words is what a bad one does.
 */
function violatesSimilarity(c: CandidateAction, input: RuleInput): boolean {
  const last = input.lastQuestion;
  if (!last || !c.text) return false;

  const sameSkills =
    c.skill_tags.length > 0 &&
    last.skill_tags.length > 0 &&
    c.skill_tags.every((t) => last.skill_tags.includes(t)) &&
    last.skill_tags.every((t) => c.skill_tags.includes(t));

  if (sameSkills && c.entry_style && c.entry_style === last.entry_style) return true;

  // Stands in for the embedding check in §4 — no model call is available on the
  // fast path, and near-duplicate wording is what actually needs catching.
  return lexicalSimilarity(c.text, last.text) > 0.82;
}

/** R2 · No abrupt topic switches. Every topic change is announced before it happens. */
function pivotAllowed(c: CandidateAction, input: RuleInput): boolean {
  if (c.action !== 'NEW_GOAL_QUESTION') return true;
  const activeId = input.runtime.active_goal_id;
  if (!activeId || c.goal_id === activeId) return true;

  const active = input.coverage.goals.find((g) => g.goal_id === activeId);
  // Moving to a different goal while the current one is still open is legal, but
  // only as a soft pivot — L4 must bridge. A hard pivot needs the goal closed.
  return active ? active.status === 'satisfied' || active.status === 'abandoned' || true : true;
}

/** R11 · Never ask what memory already answers. */
function dropVerifiedTargets(candidates: CandidateAction[], input: RuleInput): CandidateAction[] {
  return candidates.filter((c) => {
    if (c.targets_evidence.length === 0) return true;
    const goal = input.coverage.goals.find((g) => g.goal_id === c.goal_id);
    if (!goal) return true;

    // Keep the question only if at least one thing it targets is still open.
    return c.targets_evidence.some((evId) => {
      const ev = goal.evidence.find((e) => e.evidence_id === evId);
      return !ev || ev.status !== 'verified' || ev.confidence < 0.8;
    });
  });
}

/** R4 · Escalate difficulty gradually — never jump two levels. */
function applyDifficultyBounds(candidates: CandidateAction[], input: RuleInput): CandidateAction[] {
  const { current_difficulty } = input.runtime;
  return candidates.filter((c) => {
    if (c.difficulty === undefined) return true;
    return Math.abs(c.difficulty - current_difficulty) <= 1;
  });
}

/**
 * R9 · Recover gracefully after weak answers.
 *
 * A candidate who has failed twice on a topic yields no further signal —
 * continuing is both unkind and uninformative. This rule protects the data as
 * much as the person.
 */
function applyRecoveryPolicy(candidates: CandidateAction[], input: RuleInput): CandidateAction[] {
  const { consecutive_weak_answers, active_goal_id, dont_know_by_goal } = input.runtime;

  if (active_goal_id && (dont_know_by_goal[active_goal_id] ?? 0) >= 2) {
    // Mandatory close. Never press a third time.
    return candidates.filter((c) => c.action === 'CLOSE_GOAL' || c.action === 'TRANSITION_SECTION');
  }

  if (consecutive_weak_answers >= 2) {
    return candidates.filter((c) => c.action === 'CLOSE_GOAL' || c.action === 'TRANSITION_SECTION');
  }

  if (consecutive_weak_answers >= 1) {
    return candidates.map((c) =>
      c.action === 'REASSURE_AND_RETRY' ? { ...c, priority: c.priority + 0.4 } : c,
    );
  }

  return candidates;
}

/** R7 · Never over-correct. Maximum two per interview. */
function applyCorrectionBudget(candidates: CandidateAction[], input: RuleInput): CandidateAction[] {
  const { corrections_used, turns_on_active_goal, consecutive_weak_answers } = input.runtime;

  const correctionLegal =
    corrections_used < 2 &&
    turns_on_active_goal >= 2 && // never inside the first two turns of a section
    consecutive_weak_answers === 0; // correcting someone already struggling compounds the damage

  return correctionLegal ? candidates : candidates.filter((c) => c.action !== 'CORRECT_AND_CONTINUE');
}

/** R8 · Maintain conversational rhythm. */
function applyRhythmPolicy(candidates: CandidateAction[], input: RuleInput): CandidateAction[] {
  const { turns_on_active_goal, recent_entry_styles } = input.runtime;
  let out = candidates;

  // No more than 4 consecutive turns on one goal without new evidence.
  if (turns_on_active_goal >= 4) {
    out = out.filter((c) => c.action !== 'PROBE_EVIDENCE');
  }

  // Never two story-style questions consecutively; alternate direct and story.
  const lastStyle = recent_entry_styles[recent_entry_styles.length - 1];
  if (lastStyle === 'story') {
    out = out.filter((c) => c.entry_style !== 'story');
  }

  // Long question after a long answer is discouraged: boost the narrow strategy.
  if ((input.lastAnswerSec ?? 0) > 90) {
    out = out.map((c) =>
      c.text && c.text.split(' ').length <= 25 ? { ...c, priority: c.priority + 0.15 } : c,
    );
  }

  return out.length > 0 ? out : candidates;
}

/**
 * R12 · A section gets a bounded number of questions.
 *
 * Runs LAST, and it is allowed to overrule everything above it, because it is
 * the only rule that guarantees the interview terminates section by section.
 * Goal satisfaction was carrying that responsibility alone and could not: a
 * goal closes on verified evidence or on running out of turns, and L1 may
 * rotate between a section's goals forever without either happening. That is
 * how one section ended up asking every question in the interview.
 *
 * Below the floor, leaving is illegal. At the ceiling, leaving is the only
 * thing left.
 */
function applySectionBudget(candidates: CandidateAction[], input: RuleInput): CandidateAction[] {
  const budget = SECTION_QUESTION_BUDGET[input.difficulty ?? 'medium'];
  const asked = input.runtime.questions_in_section ?? 0;

  const section = input.blueprint.sections.find(
    (s) => s.section_id === input.runtime.current_section_id,
  );
  const goals = input.coverage.goals.filter((g) => g.section_id === input.runtime.current_section_id);
  const allDone =
    goals.length > 0 && goals.every((g) => g.status === 'satisfied' || g.status === 'abandoned');

  const overTime =
    section !== undefined &&
    (input.sectionElapsedSec ?? 0) > section.time_ceiling_sec;

  // Ceiling, or the section is genuinely finished, or it has run over its time
  // budget: the only remaining move is out.
  if (asked >= budget.max || allDone || overTime) {
    const leaving = candidates.filter((c) => c.action === 'TRANSITION_SECTION');
    return leaving.length > 0
      ? leaving
      : [
          {
            action: 'TRANSITION_SECTION',
            section_id: input.runtime.current_section_id,
            skill_tags: [],
            source_kind: 'none',
            targets_evidence: [],
            priority: 1,
          },
        ];
  }

  // Floor. The warm-up and the close are exempt — they have their own natural
  // length and padding them out helps nobody.
  const hasFloor = section !== undefined && !NO_FLOOR_SECTIONS.has(section.type);
  if (hasFloor && asked < budget.min) {
    const staying = candidates.filter((c) => c.action !== 'TRANSITION_SECTION');
    if (staying.length > 0) return staying;
  }

  return candidates;
}

/**
 * R13 · Vary what KIND of question gets asked.
 *
 * A section's bank holds resume-grounded questions, straight skill checks and
 * behavioural ones, but L1 selects purely by evidence gap — so whichever kind
 * happened to target the largest gap got asked over and over, and the skill
 * checks were never reached. This is what makes the mix actually reach the
 * candidate rather than merely existing in the blueprint.
 *
 * A boost, not a ban: if the only question that closes a real gap is the same
 * kind as the last two, it should still win.
 */
function applyGradingModeVariety(
  candidates: CandidateAction[],
  input: RuleInput,
): CandidateAction[] {
  const recent = input.runtime.recent_grading_modes ?? [];
  if (recent.length < 2) return candidates;

  const lastTwo = recent.slice(-2);
  if (lastTwo[0] !== lastTwo[1]) return candidates;

  const overused = lastTwo[0];
  return candidates.map((c) =>
    c.grading_mode && c.grading_mode !== overused ? { ...c, priority: c.priority + 0.3 } : c,
  );
}

/**
 * R3 · Reference previous answers naturally.
 * Ceiling: at most one callback per three turns, and never two consecutively —
 * over-callbacking reads as a parlour trick rather than attention.
 */
function boostCallbacks(candidates: CandidateAction[], input: RuleInput): CandidateAction[] {
  const { turn, last_callback_turn, active_goal_id } = input.runtime;
  const cooling = last_callback_turn !== null && turn - last_callback_turn < 3;

  if (cooling) return candidates.filter((c) => c.action !== 'CALLBACK');

  return candidates.map((c) => {
    if (c.action !== 'CALLBACK') return c;
    const onTopic = c.goal_id === active_goal_id;
    return { ...c, priority: c.priority + (onTopic ? 0.35 : 0.1) };
  });
}

// ── Post-validation ──────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** Rejects an intent L1 should not have been able to produce. */
export function validateIntent(
  intent: ConversationalIntent,
  shortlist: CandidateAction[],
  input: RuleInput,
): ValidationResult {
  const allowed = new Set(shortlist.map((c) => c.action));
  if (!allowed.has(intent.action)) {
    return { valid: false, reason: `action ${intent.action} was not in the legal set` };
  }

  // R4 · never jump two levels.
  if (Math.abs(intent.difficulty_delta) > 1) {
    return { valid: false, reason: 'difficulty_delta out of range' };
  }
  if (intent.difficulty_delta === 1) {
    if (input.runtime.consecutive_weak_answers > 0) {
      return { valid: false, reason: 'cannot escalate difficulty after a weak answer' };
    }
    // After a -1, no +1 for at least 2 turns. No yo-yo.
    if (input.runtime.turns_since_difficulty_drop < 2) {
      return { valid: false, reason: 'difficulty dropped too recently to raise it' };
    }
  }
  if (intent.difficulty_delta === -1 && input.runtime.consecutive_weak_answers < 1) {
    return { valid: false, reason: 'no reason to lower difficulty' };
  }

  // R2 · a hard pivot is only legal when the previous goal closed.
  if (intent.transition_type === 'hard_pivot' && input.runtime.active_goal_id) {
    const active = input.coverage.goals.find((g) => g.goal_id === input.runtime.active_goal_id);
    if (active && active.status !== 'satisfied' && active.status !== 'abandoned') {
      return { valid: false, reason: 'hard_pivot while the active goal is still open' };
    }
  }

  // R10 · a section change that arrives as a bare question is rejected.
  if (intent.action === 'TRANSITION_SECTION' && intent.transition_type !== 'section_change') {
    return { valid: false, reason: 'TRANSITION_SECTION must carry transition_type section_change' };
  }

  // R7 · correction budget.
  if (intent.action === 'CORRECT_AND_CONTINUE' && input.runtime.corrections_used >= 2) {
    return { valid: false, reason: 'correction budget exhausted' };
  }

  // R3 · a callback must name a real memory item.
  if (intent.action === 'CALLBACK' && !intent.callback_memory_id) {
    return { valid: false, reason: 'CALLBACK without a memory reference' };
  }

  return { valid: true };
}

/**
 * Validates L4's wording. R5, R6, and R3's "must name the thing" clause.
 * Returns a repaired plan rather than failing — a slightly plainer sentence is
 * always better than a stalled turn (invariant 12).
 */
export function validateAndRepairPlan(
  plan: UtterancePlan,
  runtime: SessionRuntime,
  opts: { callbackNouns?: string[] } = {},
): { plan: UtterancePlan; repairs: string[] } {
  const repairs: string[] = [];
  const next = { ...plan };

  // R5 · acknowledgements are neutral, never evaluative.
  if (next.acknowledgement && FORBIDDEN_ACK_PATTERNS.some((re) => re.test(next.acknowledgement))) {
    next.acknowledgement = pickAcknowledgement(runtime);
    repairs.push('R5: replaced an evaluative acknowledgement');
  }

  // R6 · never reuse an acknowledgement phrase within 4 turns.
  const banned = runtime.recent_acknowledgements.slice(-4);
  if (next.acknowledgement && banned.includes(next.acknowledgement.trim())) {
    next.acknowledgement = pickAcknowledgement(runtime);
    repairs.push('R6: acknowledgement reused within 4 turns');
  }

  // R3 · a callback must name a concrete noun from the memory item.
  if (opts.callbackNouns?.length) {
    const said = `${next.transition} ${next.utterance}`.toLowerCase();
    const namesIt = opts.callbackNouns.some((n) => n && said.includes(n.toLowerCase()));
    if (!namesIt) {
      next.transition = `Earlier you mentioned ${opts.callbackNouns[0]} —`;
      repairs.push('R3: callback did not name the thing');
    }
  }

  return { plan: next, repairs };
}

/** Draws from the rotating pool so R6 still holds under the acknowledgement cover. */
export function pickAcknowledgement(runtime: SessionRuntime): string {
  const banned = new Set(runtime.recent_acknowledgements.slice(-4).map((a) => a.trim()));
  const available = ACKNOWLEDGEMENT_POOL.filter((a) => !banned.has(a));
  const pool = available.length > 0 ? available : ACKNOWLEDGEMENT_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function lexicalSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}
