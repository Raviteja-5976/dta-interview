/**
 * The model catalog — the ONLY file that names concrete models.
 *
 * When a provider ships a new model or changes prices, you edit this file and
 * nothing else. Every agent references a tier, never a model id.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Prices verified 2026-08-08 against:
 *   OpenAI  https://developers.openai.com/api/docs/models
 *   Google  https://ai.google.dev/gemini-api/docs/pricing
 *   xAI     https://docs.x.ai/docs/models
 * USD per 1M tokens. Re-check before relying on the cost figures in `agent_runs`.
 *
 * Context windows are set conservatively (at or below the published figure) so
 * that prompt budgeting fails safe. Only the OpenAI numbers are provider-confirmed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ModelSpec, ModelTier, ProviderId } from './types';

type Catalog = Record<ProviderId, Record<ModelTier, ModelSpec>>;

/**
 * ── Why the ladder sits where it does ────────────────────────────────────────
 * The ladder is pinned to unit economics, not to what is impressive.
 *
 * A 15-minute interview sells for 75 credits ≈ ₹75 ≈ $0.85. Everything the
 * session costs — prep, ~50 live calls, ~15 grading calls, STT and TTS — has to
 * fit inside that with margin left over.
 *
 * That is what rules out the frontier tier for routine work. On OpenAI, moving
 * one agent from `luna` to `terra` is a 10× jump in unit cost; moving to `sol` is
 * 25×. `sol` earns that on nothing here, so nothing is wired to it — it stays in
 * reach through `AI_MODEL_<AGENT>` for anyone who wants to A/B it.
 *
 * Three tiers resolving to the same OpenAI model is not an accident. The tiers
 * differ in timeout, temperature and retry policy (see config.ts), they diverge
 * on Gemini and Grok, and they record intent: when a cheaper model ships, `nano`
 * moves and `balanced` does not.
 */
export const CATALOG: Catalog = {
  /**
   * OpenAI — the active provider.
   *
   * `luna` is not a weak model. It is the cost-optimised member of the current
   * frontier family, with the same 1M context as its siblings — which is exactly
   * what makes a cheap ladder viable here.
   */
  openai: {
    nano: {
      id: 'gpt-5.6-luna',
      pricing: { input: 0.2, output: 1.2 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: false,
      supportsReasoningEffort: true,
    },
    fast: {
      id: 'gpt-5.6-luna',
      pricing: { input: 0.2, output: 1.2 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: false,
      supportsReasoningEffort: true,
    },
    balanced: {
      id: 'gpt-5.6-luna',
      pricing: { input: 0.2, output: 1.2 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: false,
      supportsReasoningEffort: true,
    },
    // Reserved for generative work whose quality compounds: the blueprint, and
    // coding problems whose hidden tests have to be arithmetically correct.
    deep: {
      id: 'gpt-5.6-terra',
      pricing: { input: 2.0, output: 12.0 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: false,
      supportsReasoningEffort: true,
    },
  },

  google: {
    nano: {
      id: 'gemini-3.5-flash-lite',
      pricing: { input: 0.3, output: 2.5 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
    fast: {
      id: 'gemini-3.5-flash-lite',
      pricing: { input: 0.3, output: 2.5 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
    balanced: {
      id: 'gemini-3.5-flash-lite',
      pricing: { input: 0.3, output: 2.5 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
    deep: {
      // 3.6-flash over 3.5-flash: same input price, cheaper output ($7.50 vs $9.00).
      id: 'gemini-3.6-flash',
      pricing: { input: 1.5, output: 7.5 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
  },

  xai: {
    nano: {
      id: 'grok-build-0.1',
      pricing: {
        input: 1.0,
        output: 2.0,
        longContextFrom: 200_000,
        inputLong: 2.0,
        outputLong: 4.0,
      },
      contextWindow: 256_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
    fast: {
      id: 'grok-build-0.1',
      pricing: {
        input: 1.0,
        output: 2.0,
        longContextFrom: 200_000,
        inputLong: 2.0,
        outputLong: 4.0,
      },
      contextWindow: 256_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
    balanced: {
      id: 'grok-build-0.1',
      pricing: {
        input: 1.0,
        output: 2.0,
        longContextFrom: 200_000,
        inputLong: 2.0,
        outputLong: 4.0,
      },
      contextWindow: 256_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
    deep: {
      id: 'grok-4.3',
      pricing: {
        input: 1.25,
        output: 2.5,
        longContextFrom: 200_000,
        inputLong: 2.5,
        outputLong: 5.0,
      },
      contextWindow: 256_000,
      structuredOutputs: true,
      supportsTemperature: true,
      supportsReasoningEffort: false,
    },
  },
};

// ── Voice models ─────────────────────────────────────────────────────────────

export interface VoiceModelSpec {
  id: string;
  /** USD. STT bills per minute of audio; TTS per 1M characters of input. */
  pricePerMinute?: number;
  pricePer1MChars?: number;
  /**
   * Whether the model returns WORD-level timestamps. E2's entire speech-metrics
   * layer is arithmetic over per-word timing, so `false` here means fluency
   * cannot be scored at all — not that it is scored slightly worse.
   */
  wordTimestamps?: boolean;
  /** Whether the model accepts free-text delivery direction (L4's prosody). */
  supportsInstructions?: boolean;
  streaming?: boolean;
}

/**
 * ── The whisper-1 decision ───────────────────────────────────────────────────
 * OpenAI's docs are explicit: "The timestamp_granularities[] parameter is only
 * supported for whisper-1." Not gpt-transcribe, not gpt-live-transcribe, not
 * gpt-4o-transcribe-diarize (which gives segment timing only).
 *
 * agentdesign.md D7 chose a cascaded pipeline precisely so that word-level
 * timestamps come from the live STT rather than a second transcription pass, and
 * §12 lists "STT without word-level timestamps" as a build-stopping risk. So the
 * model that supports them is the only candidate.
 *
 * It is also 2.8× cheaper than gpt-live-transcribe ($0.006 vs $0.017/min), so
 * this costs nothing to get right.
 *
 * The trade-off it does carry: whisper-1 does not stream. Answers are
 * transcribed after the candidate stops, which adds ~1-2s per turn. The
 * alternative — streaming with gpt-live-transcribe for the UI plus whisper-1
 * afterwards for timing — is the "pay twice and reconcile two clocks" shape D7
 * explicitly rejects. One clock, native word timing, lower bill.
 */
type VoicePair = { stt: VoiceModelSpec; tts: VoiceModelSpec };

const OPENAI_VOICE: VoicePair = {
  stt: {
    id: 'whisper-1',
    pricePerMinute: 0.006,
    wordTimestamps: true,
    streaming: false,
  },
  tts: {
    // gpt-4o-mini-tts is the only TTS model that accepts `instructions`, which
    // is how L4's prosody actually reaches the audio. tts-1 ignores it entirely,
    // which would make the Dialogue Styler's delivery work decorative.
    id: 'gpt-4o-mini-tts',
    pricePer1MChars: 12.0,
    supportsInstructions: true,
  },
};

/**
 * Gemini's speech surface does not expose word-level timestamps, so switching
 * voice to Google trades E2's entire fluency layer for whatever else it buys.
 * `wordTimestamps: false` is what makes that trade visible instead of silent.
 */
const GOOGLE_VOICE: VoicePair = {
  stt: { id: 'gemini-3.6-flash', wordTimestamps: false, streaming: true },
  tts: { id: 'gemini-3.1-flash-tts-preview', supportsInstructions: true },
};

export const VOICE_CATALOG: Record<'openai' | 'google', VoicePair> = {
  openai: OPENAI_VOICE,
  google: GOOGLE_VOICE,
};

export type VoiceProviderId = keyof typeof VOICE_CATALOG;

/** STT cost for a stretch of audio. */
export function sttCostUsd(provider: VoiceProviderId, seconds: number): number | undefined {
  const rate = VOICE_CATALOG[provider].stt.pricePerMinute;
  if (rate === undefined) return undefined;
  return Math.round((seconds / 60) * rate * 1_000_000) / 1_000_000;
}

/** TTS cost for a stretch of text. */
export function ttsCostUsd(provider: VoiceProviderId, characters: number): number | undefined {
  const rate = VOICE_CATALOG[provider].tts.pricePer1MChars;
  if (rate === undefined) return undefined;
  return Math.round((characters / 1_000_000) * rate * 1_000_000) / 1_000_000;
}

export const PROVIDER_IDS: ProviderId[] = ['openai', 'google', 'xai'];

/** Env var holding each provider's key. Checked at resolution time, not import. */
export const PROVIDER_ENV_KEY: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  xai: 'XAI_API_KEY',
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as string[]).includes(value);
}

export function getModelSpec(provider: ProviderId, tier: ModelTier): ModelSpec {
  return CATALOG[provider][tier];
}

/**
 * Cost of one call in USD. Returns `undefined` when the provider did not report
 * token usage — better a null in `agent_runs` than a number that looks real.
 */
export function computeCostUsd(
  spec: ModelSpec,
  inputTokens?: number,
  outputTokens?: number,
): number | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined;

  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  const { pricing } = spec;

  const useLongRates =
    pricing.longContextFrom !== undefined && inTok >= pricing.longContextFrom;

  const inRate = useLongRates ? (pricing.inputLong ?? pricing.input) : pricing.input;
  const outRate = useLongRates ? (pricing.outputLong ?? pricing.output) : pricing.output;

  const cost = (inTok / 1_000_000) * inRate + (outTok / 1_000_000) * outRate;
  // agent_runs.cost_usd is numeric(10,6); round to match so the column never truncates.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
