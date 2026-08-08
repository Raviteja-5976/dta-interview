/**
 * E2 · Speech Metrics Service
 *
 * Pure arithmetic over word-level timestamps. No model, no network.
 *
 * This entire file is why D7 chose a cascaded voice pipeline over speech-to-speech:
 * every number below is computed from per-word timing, and speech-to-speech APIs
 * do not return reliable word-level timing. If your STT does not emit it, none of
 * this works — that is a hard vendor requirement, not a preference.
 *
 * ── Fairness (agentdesign.md §9.4) ───────────────────────────────────────────
 * The primary user base speaks English as a second or third language.
 *   1. Pronunciation and accent are NEVER scored. ASR confidence measures
 *      accent-model fit, not clarity; using it as a speaking score would penalise
 *      exactly the people this product exists to help. It is used here only to
 *      gate reliability, never to reduce a score.
 *   2. WPM bands are calibrated per language variety. A US-calibrated band tells
 *      fluent Indian-English speakers they are too slow.
 */

import type { WordTiming } from './types';

const PAUSE_THRESHOLD_MS = 300;
const LONG_PAUSE_MS = 2000;

/** Answers below these thresholds produce unreliable metrics and are excluded. */
const MIN_WORDS_FOR_RELIABILITY = 25;
const MIN_ASR_CONFIDENCE = 0.85;

const FILLERS = new Set([
  'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm',
  'like', 'basically', 'actually', 'literally', 'right', 'yeah',
  'so', 'well', 'okay', 'ok',
]);

/**
 * Only ever counted as a filler mid-sentence — "so" opening a clause is normal
 * speech, and counting it would inflate every candidate's filler rate.
 */
const CONTEXTUAL_FILLERS = new Set(['so', 'well', 'right', 'yeah', 'okay', 'ok', 'like', 'actually']);

// ── WPM calibration ──────────────────────────────────────────────────────────

export interface WpmBands {
  /** [min, max] of the 10-scoring band. */
  ideal: [number, number];
  good: [number, number];
  fair: [number, number];
}

/**
 * Calibrated per English variety. sitemap-workflow.md §12 requires this to be
 * user-selectable and labelled plainly: "used to calibrate speaking-pace feedback".
 */
export const WPM_BANDS: Record<string, WpmBands> = {
  'en-US': { ideal: [130, 165], good: [115, 180], fair: [100, 200] },
  'en-GB': { ideal: [125, 160], good: [110, 175], fair: [95, 195] },
  // Indian English averages meaningfully lower WPM with no loss of clarity.
  'en-IN': { ideal: [115, 150], good: [100, 165], fair: [88, 185] },
  'en-AU': { ideal: [128, 162], good: [112, 178], fair: [98, 198] },
};

export function bandsFor(language: string | undefined): WpmBands {
  return WPM_BANDS[language ?? 'en-IN'] ?? WPM_BANDS['en-US'];
}

// ── Per-answer metrics ───────────────────────────────────────────────────────

export interface SpeechMetrics {
  word_count: number;
  answer_duration_sec: number;
  speaking_time_sec: number;
  wpm_articulation: number | null;
  wpm_gross: number | null;
  filler_count: number;
  filler_rate: number;
  filler_breakdown: Array<{ word: string; count: number }>;
  pause_count: number;
  long_pause_count: number;
  long_pauses_per_min: number;
  longest_pause_ms: number;
  repetition_rate: number;
  time_to_first_word_ms: number | null;
  asr_confidence_avg: number | null;
  /** 'low' excludes this answer from every aggregate. */
  reliability: 'ok' | 'low';
  reliability_reason?: string;
}

export function computeSpeechMetrics(
  words: WordTiming[],
  opts: { silenceBeforeMs?: number; asrConfidenceAvg?: number } = {},
): SpeechMetrics {
  const wordCount = words.length;

  if (wordCount === 0) {
    return emptyMetrics(opts.asrConfidenceAvg ?? null, 'no words transcribed');
  }

  const first = words[0];
  const last = words[wordCount - 1];
  const answerDurationMs = Math.max(0, last.e - first.s);

  // Pauses are inter-word gaps over the threshold.
  let pausedMs = 0;
  let pauseCount = 0;
  let longPauseCount = 0;
  let longestPauseMs = 0;

  for (let i = 1; i < wordCount; i += 1) {
    const gap = words[i].s - words[i - 1].e;
    if (gap > PAUSE_THRESHOLD_MS) {
      pausedMs += gap;
      pauseCount += 1;
      if (gap > longestPauseMs) longestPauseMs = gap;
      if (gap >= LONG_PAUSE_MS) longPauseCount += 1;
    }
  }

  const speakingTimeMs = Math.max(1, answerDurationMs - pausedMs);
  const wpmArticulation = wordCount / (speakingTimeMs / 60_000);
  const wpmGross = answerDurationMs > 0 ? wordCount / (answerDurationMs / 60_000) : null;

  // Fillers
  const breakdown = new Map<string, number>();
  let fillerCount = 0;
  words.forEach((word, i) => {
    const w = word.w.toLowerCase().replace(/[^a-z]/g, '');
    if (!FILLERS.has(w)) return;
    // Contextual fillers only count mid-utterance, not as a sentence opener.
    if (CONTEXTUAL_FILLERS.has(w) && isClauseOpener(words, i)) return;
    fillerCount += 1;
    breakdown.set(w, (breakdown.get(w) ?? 0) + 1);
  });

  const asrConfidenceAvg =
    opts.asrConfidenceAvg ??
    (words.some((w) => w.conf !== undefined)
      ? words.reduce((acc, w) => acc + (w.conf ?? 1), 0) / wordCount
      : null);

  let reliability: 'ok' | 'low' = 'ok';
  let reliabilityReason: string | undefined;
  if (wordCount < MIN_WORDS_FOR_RELIABILITY) {
    reliability = 'low';
    reliabilityReason = `only ${wordCount} words`;
  } else if (asrConfidenceAvg !== null && asrConfidenceAvg < MIN_ASR_CONFIDENCE) {
    reliability = 'low';
    reliabilityReason = 'low transcription confidence';
  }

  const answerDurationSec = answerDurationMs / 1000;

  return {
    word_count: wordCount,
    answer_duration_sec: round1(answerDurationSec),
    speaking_time_sec: round1(speakingTimeMs / 1000),
    wpm_articulation: round1(wpmArticulation),
    wpm_gross: wpmGross !== null ? round1(wpmGross) : null,
    filler_count: fillerCount,
    filler_rate: round3(fillerCount / wordCount),
    filler_breakdown: [...breakdown.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count),
    pause_count: pauseCount,
    long_pause_count: longPauseCount,
    long_pauses_per_min: answerDurationSec > 0 ? round1(longPauseCount / (answerDurationSec / 60)) : 0,
    longest_pause_ms: longestPauseMs,
    repetition_rate: round3(repetitionRate(words)),
    time_to_first_word_ms: opts.silenceBeforeMs ?? null,
    asr_confidence_avg: asrConfidenceAvg !== null ? round3(asrConfidenceAvg) : null,
    reliability,
    reliability_reason: reliabilityReason,
  };
}

/** Immediate word and bigram repeats — "the the", "I was I was". */
function repetitionRate(words: WordTiming[]): number {
  if (words.length < 2) return 0;
  const norm = words.map((w) => w.w.toLowerCase().replace(/[^a-z]/g, ''));

  let repeats = 0;
  for (let i = 1; i < norm.length; i += 1) {
    if (norm[i] && norm[i] === norm[i - 1]) repeats += 1;
  }
  for (let i = 3; i < norm.length; i += 1) {
    if (norm[i] === norm[i - 2] && norm[i - 1] === norm[i - 3]) repeats += 1;
  }
  return repeats / norm.length;
}

function isClauseOpener(words: WordTiming[], i: number): boolean {
  if (i === 0) return true;
  // A preceding pause makes this the start of a new clause in speech.
  return words[i].s - words[i - 1].e > 400;
}

// ── Session rollup ───────────────────────────────────────────────────────────

export interface SpeechSummary {
  wpm: number | null;
  wpm_by_question: Array<{ seq: number; wpm: number | null }>;
  filler_rate: number | null;
  filler_breakdown: Array<{ word: string; count: number }>;
  long_pauses_per_min: number | null;
  repetition_rate: number | null;
  avg_time_to_first_word_ms: number | null;
  total_speaking_sec: number;
  excluded_questions: number[];
  language: string;
  /** Persistent, always shown: this is coaching, never a competence measure. */
  note: string;
}

export function summariseSpeech(
  perQuestion: Array<{ seq: number; metrics: SpeechMetrics }>,
  language: string,
): SpeechSummary {
  const reliable = perQuestion.filter((q) => q.metrics.reliability === 'ok');
  const excluded = perQuestion.filter((q) => q.metrics.reliability === 'low').map((q) => q.seq);

  const totalWords = reliable.reduce((acc, q) => acc + q.metrics.word_count, 0);
  const totalSpeaking = reliable.reduce((acc, q) => acc + q.metrics.speaking_time_sec, 0);
  const totalFillers = reliable.reduce((acc, q) => acc + q.metrics.filler_count, 0);

  const breakdown = new Map<string, number>();
  for (const q of reliable) {
    for (const f of q.metrics.filler_breakdown) {
      breakdown.set(f.word, (breakdown.get(f.word) ?? 0) + f.count);
    }
  }

  const ttfw = reliable
    .map((q) => q.metrics.time_to_first_word_ms)
    .filter((v): v is number => v !== null);

  return {
    wpm: totalSpeaking > 0 ? round1(totalWords / (totalSpeaking / 60)) : null,
    wpm_by_question: perQuestion.map((q) => ({ seq: q.seq, wpm: q.metrics.wpm_articulation })),
    filler_rate: totalWords > 0 ? round3(totalFillers / totalWords) : null,
    filler_breakdown: [...breakdown.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count),
    long_pauses_per_min: reliable.length
      ? round1(avg(reliable.map((q) => q.metrics.long_pauses_per_min)))
      : null,
    repetition_rate: reliable.length ? round3(avg(reliable.map((q) => q.metrics.repetition_rate))) : null,
    avg_time_to_first_word_ms: ttfw.length ? Math.round(avg(ttfw)) : null,
    total_speaking_sec: round1(totalSpeaking),
    excluded_questions: excluded,
    language,
    note: 'Speech metrics are coaching signals, not a measure of competence. Pronunciation and accent are never scored.',
  };
}

/** Detects the second-half drift worth calling out in the report. */
export function fillerTrend(perQuestion: Array<{ seq: number; metrics: SpeechMetrics }>): string | undefined {
  const reliable = perQuestion.filter((q) => q.metrics.reliability === 'ok');
  if (reliable.length < 4) return undefined;

  const mid = Math.floor(reliable.length / 2);
  const firstHalf = avg(reliable.slice(0, mid).map((q) => q.metrics.filler_rate));
  const secondHalf = avg(reliable.slice(mid).map((q) => q.metrics.filler_rate));

  if (secondHalf - firstHalf > 0.02) {
    return `Filler rate rose from ${pct(firstHalf)} to ${pct(secondHalf)} in the second half — a stress signal, not a habit.`;
  }
  if (firstHalf - secondHalf > 0.02) {
    return `Filler rate fell from ${pct(firstHalf)} to ${pct(secondHalf)} — you settled as the interview went on.`;
  }
  return undefined;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function emptyMetrics(asr: number | null, reason: string): SpeechMetrics {
  return {
    word_count: 0,
    answer_duration_sec: 0,
    speaking_time_sec: 0,
    wpm_articulation: null,
    wpm_gross: null,
    filler_count: 0,
    filler_rate: 0,
    filler_breakdown: [],
    pause_count: 0,
    long_pause_count: 0,
    long_pauses_per_min: 0,
    longest_pause_ms: 0,
    repetition_rate: 0,
    time_to_first_word_ms: null,
    asr_confidence_avg: asr,
    reliability: 'low',
    reliability_reason: reason,
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
