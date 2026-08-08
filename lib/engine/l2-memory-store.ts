/**
 * L2 · Structured Interview Memory — the deterministic store.
 *
 * The extraction agent lives in lib/agents/l2-memory.ts; this file owns the
 * store it writes into and the priority queue L1 reads from.
 *
 * Design decision D4: memory is not a transcript and not a topic list. It is the
 * interviewer's working model of the person in front of them, which is why every
 * item is typed and carries confidence, importance, and callback candidates.
 *
 * `open_callbacks` is a priority queue. L1 reads the top few; L4 never sees the
 * whole store.
 */

import type { MemoryExtraction } from '../agents/schemas';

export interface MemoryCallback {
  text: string;
  best_for_goal: string;
  value: number;
}

export interface MemoryItem {
  item_id: string;
  kind: MemoryExtraction['items'][number]['kind'];
  label: string;
  detail: string;
  technologies: string[];
  related_skills: string[];
  confidence: number;
  importance: number;
  depth_signal: string;
  source_question_id: string;
  turn: number;
  verified: boolean;
  callback_candidates: MemoryCallback[];
  /** Set once used, so a callback is never fired twice. */
  spent: boolean;
}

export interface Contradiction {
  item_ids: string[];
  detail: string;
  severity: 'minor' | 'major';
  surface_in_report: boolean;
  probe: boolean;
}

export interface InterviewMemory {
  session_id: string;
  updated_at_turn: number;
  items: MemoryItem[];
  contradictions: Contradiction[];
}

export function emptyMemory(sessionId: string): InterviewMemory {
  return { session_id: sessionId, updated_at_turn: 0, items: [], contradictions: [] };
}

/** Merges an extraction pass into the store. Never mutates its input. */
export function mergeExtraction(
  memory: InterviewMemory,
  extraction: MemoryExtraction,
  meta: { turn: number; questionId: string },
): InterviewMemory {
  const next: InterviewMemory = structuredClone(memory);
  next.updated_at_turn = meta.turn;

  for (const raw of extraction.items) {
    // Same label and kind means the candidate elaborated on something already
    // known — merge rather than duplicate, and take the higher confidence.
    const existing = next.items.find(
      (i) => i.kind === raw.kind && normaliseLabel(i.label) === normaliseLabel(raw.label),
    );

    if (existing) {
      existing.detail = raw.detail || existing.detail;
      existing.confidence = Math.max(existing.confidence, raw.confidence);
      existing.importance = Math.max(existing.importance, raw.importance);
      existing.technologies = unique([...existing.technologies, ...raw.technologies]);
      existing.related_skills = unique([...existing.related_skills, ...raw.related_skills]);
      existing.depth_signal = raw.depth_signal;
      // A claim that has now been elaborated is no longer unverified.
      if (raw.depth_signal !== 'surface_mention') existing.verified = true;
      continue;
    }

    next.items.push({
      item_id: `mem_${next.items.length + 1}_${meta.turn}`,
      kind: raw.kind,
      label: raw.label,
      detail: raw.detail,
      technologies: raw.technologies,
      related_skills: raw.related_skills,
      confidence: raw.confidence,
      importance: raw.importance,
      depth_signal: raw.depth_signal,
      source_question_id: meta.questionId,
      turn: meta.turn,
      verified: false,
      callback_candidates: raw.callback_candidates,
      spent: false,
    });
  }

  for (const c of extraction.contradictions) {
    next.contradictions.push({
      item_ids: [],
      detail: c.detail,
      severity: c.severity,
      surface_in_report: c.surface_in_report,
      probe: c.probe,
    });
  }

  return next;
}

/**
 * The priority queue L1 reads. Sorted by callback value weighted by the item's
 * importance, so an unverified 40% latency claim outranks a passing mention of a
 * side project.
 */
export function openCallbacks(memory: InterviewMemory, limit = 3): MemoryItem[] {
  return memory.items
    .filter((i) => !i.spent && i.callback_candidates.length > 0)
    .sort((a, b) => callbackWeight(b) - callbackWeight(a))
    .slice(0, limit);
}

function callbackWeight(item: MemoryItem): number {
  const best = Math.max(...item.callback_candidates.map((c) => c.value), 0);
  return best * (0.5 + item.importance * 0.5);
}

export function markCallbackSpent(memory: InterviewMemory, itemId: string): InterviewMemory {
  const next: InterviewMemory = structuredClone(memory);
  const item = next.items.find((i) => i.item_id === itemId);
  if (item) item.spent = true;
  return next;
}

/**
 * Concrete nouns a callback utterance must contain, per R3. L4's output is
 * checked against these — a callback that does not name the thing is not a
 * callback, it is a generic question wearing one's clothes.
 */
export function callbackNouns(item: MemoryItem): string[] {
  return unique([...item.technologies, ...firstNouns(item.label)]);
}

function firstNouns(label: string): string[] {
  return label
    .split(/[\s,/]+/)
    .filter((w) => w.length > 3 && /^[A-Za-z][A-Za-z0-9.+-]*$/.test(w))
    .slice(0, 3);
}

function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
