/**
 * Deepgram — the entire voice layer, STT and TTS.
 *
 * This replaces the OpenAI/Google voice split. One vendor now, for one reason
 * that outranks the others: `nova-3` returns WORD-LEVEL TIMESTAMPS on the LIVE
 * socket. agentdesign.md D7 makes that a hard vendor requirement and §12 lists
 * losing it as build-stopping, because E2's whole speech-metrics layer — pace,
 * pause profile, filler rate, repetition — is arithmetic over per-word timing.
 * The previous transcriber did not return it, so the delivery panel had been
 * running on a client-measured speech window with pauses reported as
 * unavailable. This gets it back, and gets it back from the SAME pass that
 * transcribes the answer, which is invariant 16 stated exactly.
 *
 * ── The three surfaces ───────────────────────────────────────────────────────
 *   /v1/auth/grant   short-lived JWT so the BROWSER can open the live socket
 *   /v1/listen       prerecorded, the fallback for when the socket never opened
 *   /v1/speak        TTS, streamed straight through to the audio element
 *
 * ── Raw fetch rather than @deepgram/sdk ──────────────────────────────────────
 * Two of these three are streams handed to something else verbatim: /speak's
 * body goes to an <audio> element, and the live socket is opened by the
 * browser, not by this file. An SDK that resolves a stream into a Buffer is
 * actively in the way for both. The REST surface here is three endpoints and a
 * JSON body, so the dependency buys nothing it does not also cost.
 */

import { recordAgentRun } from './telemetry';
import type { RunContext } from './types';
import type { WordTiming } from '../engine/types';

const API_BASE = 'https://api.deepgram.com';

/**
 * Models, pinned here rather than at the call sites.
 *
 * `nova-3` is the only STT choice that matters: it is the one carrying word
 * timings on the streaming endpoint. `aura-2` is the current TTS generation.
 */
export const DEEPGRAM_STT_MODEL = process.env.DEEPGRAM_STT_MODEL || 'nova-3';
export const DEEPGRAM_TTS_MODEL = process.env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en';

/**
 * Prices, USD. Re-verify against Deepgram's pricing page before trusting the
 * figures that land in `agent_runs` — the same caveat catalog.ts carries for
 * the language models, and for the same reason.
 *
 * Streaming STT is billed per minute of audio; TTS per character.
 */
export const DEEPGRAM_PRICING = {
  sttPerMinute: 0.0077,
  ttsPer1MChars: 30.0,
} as const;

export function isDeepgramConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

function requireKey(): string {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new Error('Voice is not configured: DEEPGRAM_API_KEY is unset.');
  }
  return key;
}

export function sttCostUsd(seconds: number): number {
  return Math.round((seconds / 60) * DEEPGRAM_PRICING.sttPerMinute * 1_000_000) / 1_000_000;
}

export function ttsCostUsd(characters: number): number {
  return Math.round((characters / 1_000_000) * DEEPGRAM_PRICING.ttsPer1MChars * 1_000_000) / 1_000_000;
}

// ── Language ─────────────────────────────────────────────────────────────────

/**
 * Sessions carry BCP-47 (`en-IN`). nova-3 wants a bare language code for
 * English and rejects most regional variants outright, so the region is dropped
 * rather than passed through — a 400 mid-interview costs the turn, and nova-3's
 * English model already handles Indian English without being told.
 *
 * `multi` stays reachable for a caller that genuinely wants code-switching.
 */
export function deepgramLanguage(language: string | undefined): string {
  if (!language) return 'en';
  if (language === 'multi') return 'multi';
  return language.split('-')[0] || 'en';
}

// ── Browser auth ─────────────────────────────────────────────────────────────

export interface AccessToken {
  accessToken: string;
  /** Seconds until it stops working. */
  expiresIn: number;
}

/**
 * Mints a short-lived JWT the browser can open the live socket with.
 *
 * This is the only reason the live leg is allowed to run client-side at all.
 * The API key stays on the server; the browser gets a token that expires in
 * minutes and carries usage rights only — it cannot reach the Manage API, so a
 * leaked one cannot read the account or rotate a key.
 *
 * Only the CONNECTION needs a valid token. An already-open socket is unaffected
 * when its token expires mid-answer, so the TTL only has to cover the gap
 * between minting and connecting.
 */
export async function mintAccessToken(ttlSeconds = 300): Promise<AccessToken> {
  const res = await fetch(`${API_BASE}/v1/auth/grant`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${requireKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Deepgram token grant failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Deepgram token grant returned no token.');

  return { accessToken: body.access_token, expiresIn: body.expires_in ?? ttlSeconds };
}

// ── Speech to text · prerecorded ─────────────────────────────────────────────

export interface TranscriptionOutput {
  text: string;
  words: WordTiming[];
  durationSec: number;
  hasWordTimings: boolean;
  confidenceAvg?: number;
}

/**
 * The batch path — used when the live socket never opened.
 *
 * A genuine fallback rather than the main road: the live socket already
 * transcribed the answer while it was being spoken, so reaching here means the
 * browser could not hold a WebSocket and we are re-transcribing a clip we
 * already have. Same model, same word timings, just paid for twice and arriving
 * after the candidate stopped talking rather than during.
 */
export async function transcribePrerecorded(
  audio: ArrayBuffer | Uint8Array,
  opts: { language?: string; mimeType?: string; context?: RunContext } = {},
): Promise<TranscriptionOutput> {
  const started = Date.now();

  const params = new URLSearchParams({
    model: DEEPGRAM_STT_MODEL,
    language: deepgramLanguage(opts.language),
    smart_format: 'true',
    punctuate: 'true',
  });

  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);

  const res = await fetch(`${API_BASE}/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${requireKey()}`,
      'Content-Type': opts.mimeType || 'audio/webm',
    },
    body: bytes as unknown as BodyInit,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    throw new Error(`Deepgram transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as DeepgramPrerecordedResponse;
  const alt = body.results?.channels?.[0]?.alternatives?.[0];
  const durationSec = body.metadata?.duration ?? 0;

  /*
   * No speech in the clip is NOT a failure. "Silence is not an error state"
   * (sitemap-workflow.md §9) — a candidate who paused, coughed, or muted their
   * mic should get the interviewer gently following up, not a 500 that kills
   * the turn. An empty transcript is the honest representation: L3 finds no
   * evidence, marks the answer weak, and R9 boosts REASSURE_AND_RETRY.
   */
  const words = toWordTimings(alt?.words ?? []);

  recordAgentRun({
    // L5 has no model of its own; voice spend is logged against the live phase.
    agent: 'L2',
    phase: 'live',
    provider: 'deepgram',
    model: DEEPGRAM_STT_MODEL,
    latencyMs: Date.now() - started,
    audioSec: Math.round(durationSec * 100) / 100,
    costUsd: sttCostUsd(durationSec),
    ok: true,
    context: opts.context,
    meta: { step: 'stt', mode: 'prerecorded', words: words.length, empty: words.length === 0 },
  });

  return {
    text: alt?.transcript?.trim() ?? '',
    words,
    durationSec,
    hasWordTimings: words.length > 0,
    confidenceAvg: alt?.confidence,
  };
}

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
}

interface DeepgramPrerecordedResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: DeepgramWord[];
      }>;
    }>;
  };
}

/**
 * Deepgram seconds → the millisecond shape E2 reads.
 *
 * `punctuated_word` is deliberately NOT used: E2 counts fillers and repetitions
 * by comparing word forms, and "um," and "um" are not the same string. The
 * unpunctuated form is the one that compares correctly.
 */
export function toWordTimings(words: DeepgramWord[]): WordTiming[] {
  return words
    .map((w) => ({
      w: (w.word ?? '').trim(),
      s: Math.round(w.start * 1000),
      e: Math.round(w.end * 1000),
      conf: w.confidence,
    }))
    .filter((w) => w.w.length > 0);
}

// ── Text to speech ───────────────────────────────────────────────────────────

export interface SpeakOptions {
  /** An Aura voice id, e.g. `aura-2-thalia-en`. */
  model?: string;
  /** `mp3` for anything played by an audio element. */
  encoding?: 'mp3' | 'linear16' | 'opus';
  context?: RunContext;
}

/**
 * Opens a streaming TTS response and hands back the raw upstream `Response`.
 *
 * The caller pipes `.body` onward without buffering. That is the entire point:
 * the interviewer starts talking a few hundred milliseconds after the turn
 * resolves, as the first MP3 frames arrive, rather than after a whole file has
 * been synthesised.
 *
 * ── Why REST and not the /v1/speak WebSocket ─────────────────────────────────
 * The speak socket exists for text that is still being GENERATED — you stream
 * model tokens in and audio comes out before the sentence is finished. Nothing
 * here works that way: L4 produces the complete utterance before a single byte
 * is spoken, and a bank question was written at plan time. With the full text
 * already in hand, the socket adds a handshake and a framing protocol to buy
 * latency it cannot save, because this response already streams.
 */
export async function openSpeechStream(text: string, opts: SpeakOptions = {}): Promise<Response> {
  const params = new URLSearchParams({
    model: opts.model || DEEPGRAM_TTS_MODEL,
    encoding: opts.encoding ?? 'mp3',
  });

  return fetch(`${API_BASE}/v1/speak?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${requireKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30_000),
  });
}

export interface SynthesisOutput {
  audio: Uint8Array;
  mediaType: string;
  durationSecEstimate: number;
}

/**
 * The buffered path, for P8's pre-synthesis.
 *
 * P8 renders every bank question, transition and acknowledgement to a file in
 * Storage before the interview starts, which is what turns most live turns into
 * a cache lookup instead of a synthesis call. Nothing is streaming there — the
 * output is an object in a bucket — so this one waits for the whole body.
 */
export async function synthesizeUtterance(
  text: string,
  opts: SpeakOptions = {},
): Promise<SynthesisOutput> {
  const started = Date.now();
  const model = opts.model || DEEPGRAM_TTS_MODEL;

  const res = await openSpeechStream(text, { ...opts, model });

  if (!res.ok) {
    throw new Error(`Deepgram speech failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const audio = new Uint8Array(await res.arrayBuffer());

  recordAgentRun({
    agent: 'IV',
    phase: 'live',
    provider: 'deepgram',
    model,
    latencyMs: Date.now() - started,
    costUsd: ttsCostUsd(text.length),
    ok: true,
    context: opts.context,
    meta: { step: 'tts', characters: text.length, streamed: false },
  });

  return {
    audio,
    mediaType: 'audio/mpeg',
    // ~2.6 words/second is a natural interviewer pace.
    durationSecEstimate: Math.max(1, text.split(/\s+/).length / 2.6),
  };
}

// ── Personas ─────────────────────────────────────────────────────────────────

/**
 * Persona → Aura voice.
 *
 * ── What the move to Deepgram cost, stated plainly ───────────────────────────
 * gpt-4o-mini-tts accepted `instructions` — a prose delivery direction, which
 * is how L4's prosody (emotion, rate, emphasis) actually reached the audio.
 * Aura has no equivalent: voice selection is the only delivery control it
 * exposes.
 *
 * So L4's prosody block no longer changes how a sentence SOUNDS. It still
 * changes what is said — `emotional_tone` drives the acknowledgement and the
 * wording L4 chooses, which is most of what a candidate perceives as warmth.
 * But D3's "slower when encouraging, brisker when confident" delivery is not
 * reaching the speaker any more, and shipping a dead parameter to pretend
 * otherwise would be worse than saying so. `prosodyToInstructions` is kept and
 * still logged, so the intent stays visible in `agent_runs` even where the
 * synthesiser cannot act on it.
 */
export function voiceForPersona(persona: string): string {
  switch (persona) {
    case 'warm_professional':
      return 'aura-2-thalia-en';
    case 'direct':
      return 'aura-2-orion-en';
    case 'friendly':
      return 'aura-2-luna-en';
    default:
      return DEEPGRAM_TTS_MODEL;
  }
}
