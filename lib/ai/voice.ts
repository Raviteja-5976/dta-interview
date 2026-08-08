/**
 * L5's voice layer — STT and TTS, behind the same provider abstraction as the
 * language models.
 *
 * ── The hard requirement ─────────────────────────────────────────────────────
 * The STT model MUST return WORD-level timestamps. E2's entire speech-metrics
 * layer — pace, pause profile, filler rate, repetition — is arithmetic over
 * per-word timing (agentdesign.md D7, and §12 lists "STT without word-level
 * timestamps" as a build-stopping risk).
 *
 * On OpenAI that means `whisper-1`, and only `whisper-1`: the newer transcription
 * models do not accept `timestamp_granularities`. See the note in catalog.ts.
 *
 * ── Why voice does not follow AI_PROVIDER ────────────────────────────────────
 * Language models and voice models switch independently. Voice stays on OpenAI
 * unless AI_VOICE_PROVIDER explicitly says otherwise, because the word-timestamp
 * guarantee is provider-specific and silently losing it would disable fluency
 * scoring across the whole product rather than raising an error.
 */

import { transcribe, generateSpeech } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

import { PROVIDER_ENV_KEY, VOICE_CATALOG, sttCostUsd, ttsCostUsd, type VoiceProviderId } from './catalog';
import { recordAgentRun } from './telemetry';
import type { RunContext } from './types';
import type { WordTiming } from '../engine/types';

export type { VoiceProviderId };

/**
 * Defaults to OpenAI regardless of AI_PROVIDER. Only an explicit
 * AI_VOICE_PROVIDER moves it.
 */
export function resolveVoiceProvider(): VoiceProviderId {
  const explicit = process.env.AI_VOICE_PROVIDER;
  if (explicit === 'openai' || explicit === 'google') return explicit;
  return 'openai';
}

/**
 * Not every provider exposes both model kinds — the SDK types them as optional.
 * Resolving them here means a provider that cannot do voice fails with a clear
 * message instead of `undefined is not a function` mid-interview.
 */
function voiceModelsFor(id: VoiceProviderId) {
  const apiKey = process.env[PROVIDER_ENV_KEY[id]];
  if (!apiKey) throw new Error(`Voice provider "${id}" needs ${PROVIDER_ENV_KEY[id]}.`);

  const provider = id === 'openai' ? createOpenAI({ apiKey }) : createGoogleGenerativeAI({ apiKey });
  const { stt, tts } = VOICE_CATALOG[id];

  return {
    transcription: () => {
      if (!provider.transcriptionModel) {
        throw new Error(`Voice provider "${id}" does not expose a transcription model.`);
      }
      return provider.transcriptionModel(stt.id);
    },
    speech: () => {
      if (!provider.speechModel) {
        throw new Error(`Voice provider "${id}" does not expose a speech model.`);
      }
      return provider.speechModel(tts.id);
    },
  };
}

// ── Speech to text ───────────────────────────────────────────────────────────

export interface TranscriptionOutput {
  text: string;
  words: WordTiming[];
  durationSec: number;
  /**
   * False when the provider returned only segment-level timing. E2 treats these
   * answers as low-reliability rather than computing fluency from them.
   */
  hasWordTimings: boolean;
}

export async function transcribeAnswer(
  audio: Uint8Array | ArrayBuffer,
  opts: { language?: string; context?: RunContext } = {},
): Promise<TranscriptionOutput> {
  const providerId = resolveVoiceProvider();
  const spec = VOICE_CATALOG[providerId].stt;
  const started = Date.now();

  const result = await transcribe({
    model: voiceModelsFor(providerId).transcription(),
    audio: audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio,
    providerOptions: {
      openai: {
        // The line that makes E2 possible. Only honoured by whisper-1.
        timestampGranularities: ['word'],
        // ISO-639-1 only; "en-IN" would be rejected.
        language: opts.language?.split('-')[0],
      },
    },
  });

  const words = toWordTimings(result.segments);
  const durationSec = result.segments.at(-1)?.endSecond ?? 0;

  // One segment per word is what word granularity looks like. If we got far
  // fewer segments than words, the provider gave us sentence timing instead.
  const expectedWords = result.text.trim().split(/\s+/).filter(Boolean).length;
  const hasWordTimings =
    Boolean(spec.wordTimestamps) && words.length > 0 && words.length >= expectedWords * 0.8;

  recordAgentRun({
    agent: 'L2', // L5 has no LLM of its own; voice spend is logged under the live phase.
    phase: 'live',
    provider: providerId === 'openai' ? 'openai' : 'google',
    model: spec.id,
    latencyMs: Date.now() - started,
    audioSec: Math.round(durationSec * 100) / 100,
    costUsd: sttCostUsd(providerId, durationSec),
    ok: true,
    context: opts.context,
    meta: { step: 'stt', word_timings: hasWordTimings, words: words.length },
  });

  return { text: result.text, words, durationSec, hasWordTimings };
}

function toWordTimings(
  segments: ReadonlyArray<{ text: string; startSecond: number; endSecond: number }>,
): WordTiming[] {
  return segments
    .map((s) => ({
      w: s.text.trim(),
      s: Math.round(s.startSecond * 1000),
      e: Math.round(s.endSecond * 1000),
    }))
    .filter((w) => w.w.length > 0);
}

// ── Text to speech ───────────────────────────────────────────────────────────

export interface SynthesisOutput {
  audio: Uint8Array;
  mediaType: string;
  durationSecEstimate: number;
}

export async function synthesizeUtterance(
  text: string,
  opts: { voice?: string; speed?: number; instructions?: string; context?: RunContext } = {},
): Promise<SynthesisOutput> {
  const providerId = resolveVoiceProvider();
  const spec = VOICE_CATALOG[providerId].tts;
  const started = Date.now();

  const result = await generateSpeech({
    model: voiceModelsFor(providerId).speech(),
    text,
    voice: opts.voice ?? 'alloy',
    speed: opts.speed,
    // Only sent when the model can act on it; on a model that ignores
    // instructions this would be dead weight in the request.
    providerOptions:
      opts.instructions && spec.supportsInstructions
        ? { openai: { instructions: opts.instructions } }
        : undefined,
  });

  recordAgentRun({
    agent: 'L4',
    phase: 'live',
    provider: providerId === 'openai' ? 'openai' : 'google',
    model: spec.id,
    latencyMs: Date.now() - started,
    costUsd: ttsCostUsd(providerId, text.length),
    ok: true,
    context: opts.context,
    meta: { step: 'tts', characters: text.length },
  });

  return {
    audio: result.audio.uint8Array,
    mediaType: result.audio.mediaType ?? 'audio/mpeg',
    // ~2.6 words/second is a natural interviewer pace.
    durationSecEstimate: Math.max(1, text.split(/\s+/).length / 2.6),
  };
}

/**
 * Prosody rendered as a natural-language instruction. gpt-4o-mini-tts takes
 * delivery direction as prose, and L4 is the only component permitted to
 * originate it (invariant 4: the blueprint never emits an emotion tag).
 */
export function prosodyToInstructions(prosody: {
  emotion: string;
  rate: number;
  emphasis: string[];
}): string {
  const pace =
    prosody.rate < 0.97 ? 'slightly slower than normal' : prosody.rate > 1.03 ? 'briskly' : 'at a natural pace';
  const emphasis = prosody.emphasis.length
    ? ` Stress the words: ${prosody.emphasis.join(', ')}.`
    : '';
  return `Speak in a ${prosody.emotion} tone, ${pace}, as an interviewer talking to a candidate.${emphasis}`;
}

/** Whether the active voice provider can produce the timings E2 needs. */
export function voiceSupportsWordTimings(): boolean {
  return Boolean(VOICE_CATALOG[resolveVoiceProvider()].stt.wordTimestamps);
}
