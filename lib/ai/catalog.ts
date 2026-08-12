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

import { REASONING_LADDER, type ModelSpec, type ModelTier, type ProviderId, type ReasoningEffort } from './types';

type Catalog = Record<ProviderId, Record<ModelTier, ModelSpec>>;

/**
 * What the gpt-5.6 family actually accepts.
 *
 * Note the absence of `minimal`, which the provider documents as a valid
 * reasoning-effort value. The model rejects it with a 400:
 *
 *   Unsupported value: 'minimal' is not supported with the 'gpt-5.6-luna' model.
 *   Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.
 *
 * The documented list is the union across the whole product line; per-model
 * support is narrower. This is the observed truth for this family.
 */
const GPT_56_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

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
      reasoningEfforts: GPT_56_EFFORTS,
    },
    fast: {
      id: 'gpt-5.6-luna',
      pricing: { input: 0.2, output: 1.2 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: GPT_56_EFFORTS,
    },
    balanced: {
      id: 'gpt-5.6-luna',
      pricing: { input: 0.2, output: 1.2 },
      contextWindow: 1_000_000,
      structuredOutputs: true,
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: GPT_56_EFFORTS,
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
      reasoningEfforts: GPT_56_EFFORTS,
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
   * Whether the model returns WORD-level timestamps.
   *
   * `false` does not mean fluency is unscorable — pace, fillers and repetition
   * all come from the transcript plus the client-measured speech window. It
   * means the metrics that need INTER-WORD gaps (pause profile, articulation
   * rate as distinct from gross rate) are genuinely unavailable, and E2 reports
   * them as such rather than guessing.
   */
  wordTimestamps?: boolean;
  /** Whether the model accepts free-text delivery direction (L4's prosody). */
  supportsInstructions?: boolean;
  streaming?: boolean;
}

/**
 * ── The STT decision ─────────────────────────────────────────────────────────
 * gpt-4o-mini-transcribe. It is faster and cheaper than whisper-1, and it is
 * accurate on accented English, which matters for this user base.
 *
 * What it does NOT return is per-word timestamps — `timestamp_granularities` is
 * a whisper-1-only parameter. That is a deliberate trade, not an oversight:
 *
 *   Kept:  words per minute, filler rate, repetition. All computable from the
 *          transcript plus the speech window the client measures locally, which
 *          is a truer answer duration anyway — it excludes the thinking pause
 *          before the candidate starts talking.
 *   Lost:  pause profile and articulation-rate-versus-gross-rate. Those need
 *          inter-word gaps and cannot be recovered from a flat transcript.
 *
 * `wordTimestamps: false` is what keeps that honest downstream: E2 reports the
 * pause metrics as unavailable rather than inventing them, and S1 renormalises
 * the fluency weights over the components it actually has.
 */
type VoicePair = { stt: VoiceModelSpec; tts: VoiceModelSpec };

const OPENAI_VOICE: VoicePair = {
  stt: {
    id: 'gpt-4o-mini-transcribe',
    pricePerMinute: 0.003,
    // No per-word timing. E2 works from the transcript plus the client-measured
    // speech window instead; see the note above.
    wordTimestamps: false,
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
 * Maps a requested reasoning effort onto something the model will actually take.
 *
 * The whole point of the tier abstraction is that an agent states intent and the
 * catalog resolves it. Effort has to work the same way, or pinning a different
 * model via `AI_MODEL_<AGENT>` turns a config value into a 400 at request time.
 *
 * Nearest rung on the ladder wins. Ties go DOWN — the cheaper, faster direction.
 * Falling back to less thinking than asked for is a mild quality regression;
 * silently spending more than asked for is a surprise on the bill.
 */
export function resolveReasoningEffort(
  spec: ModelSpec,
  requested: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!requested) return undefined;

  const supported = spec.reasoningEfforts;
  if (!supported || supported.includes(requested)) return requested;

  const wanted = REASONING_LADDER.indexOf(requested);
  if (wanted === -1) return undefined;

  let best: ReasoningEffort | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  // Walking the ladder low to high, with a strict `<`, means an equidistant
  // lower rung is reached first and kept — the tie-break falls out of the
  // iteration order rather than needing its own branch.
  REASONING_LADDER.forEach((candidate, index) => {
    if (!supported.includes(candidate)) return;

    const distance = Math.abs(index - wanted);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });

  return best;
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
