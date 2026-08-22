/**
 * L5's voice layer — the seam every caller goes through.
 *
 * The implementation is Deepgram (lib/ai/deepgram.ts); this file is the shape
 * the rest of the system sees, so a future provider change touches one file
 * rather than five call sites.
 *
 * ── Why voice does not follow AI_PROVIDER ────────────────────────────────────
 * Language models are a routing choice — an agent declares a tier and the
 * catalog resolves it, so the whole system moves on one env var. Voice is not,
 * and deliberately so: it rests on a capability that is provider-specific and
 * whose loss is silent rather than loud.
 *
 * The STT model MUST return WORD-level timestamps. E2's entire speech-metrics
 * layer — pace, pause profile, filler rate, repetition — is arithmetic over
 * per-word timing (D7, and §12 lists losing it as build-stopping). A provider
 * without it does not fail; it quietly produces a report with the delivery
 * panel dark. So there is one voice provider, it is named in the catalog, and
 * GET /api/ai/status reports `wordTimestampsAvailable` so the property can be
 * checked rather than assumed.
 *
 * ── Where the live path is ───────────────────────────────────────────────────
 * NOT here. The streaming socket is opened by the BROWSER
 * (lib/speech/deepgram-live.ts) against a short-lived token this app mints, so
 * the audio and the transcript take one leg each instead of three. What remains
 * in this file is the server-side work: P8's pre-synthesis, and the batch
 * transcription fallback for when that socket could not be opened.
 */

import {
  isDeepgramConfigured,
  synthesizeUtterance as deepgramSynthesize,
  transcribePrerecorded,
  voiceForPersona as deepgramVoiceForPersona,
  type SynthesisOutput,
  type TranscriptionOutput,
} from './deepgram';
import { VOICE_CATALOG, VOICE_ENV_KEY, type VoiceProviderId } from './catalog';
import type { RunContext } from './types';

export type { VoiceProviderId, SynthesisOutput, TranscriptionOutput };

/**
 * There is one, and it is not switchable by env var.
 *
 * Kept as a function rather than a constant because every caller already treats
 * it as one, and because the day a second provider earns its place the
 * signature should not have to change.
 */
export function resolveVoiceProvider(): VoiceProviderId {
  return 'deepgram';
}

export function voiceConfigured(): boolean {
  return isDeepgramConfigured();
}

export { VOICE_ENV_KEY };

/**
 * Batch transcription — the fallback path.
 *
 * The live socket normally transcribes an answer while it is being spoken, so
 * reaching this means the browser could not hold a WebSocket. Same model and
 * same word timings; it just costs a second pass and lands after the candidate
 * has already stopped talking.
 */
export async function transcribeAnswer(
  audio: Uint8Array | ArrayBuffer,
  opts: { language?: string; mimeType?: string; context?: RunContext } = {},
): Promise<TranscriptionOutput> {
  return transcribePrerecorded(audio, opts);
}

/**
 * Buffered synthesis, for P8's pre-synthesis pass.
 *
 * Live turns do not come through here — they stream from
 * /api/sessions/[id]/speak, which pipes Deepgram's response body straight to
 * the audio element without buffering.
 */
export async function synthesizeUtterance(
  text: string,
  opts: { voice?: string; context?: RunContext } = {},
): Promise<SynthesisOutput> {
  return deepgramSynthesize(text, { model: opts.voice, context: opts.context });
}

/** Persona → the concrete Aura voice that speaks the interview. */
export function voiceForPersona(persona: string): string {
  return deepgramVoiceForPersona(persona);
}

/**
 * Prosody rendered as a natural-language delivery direction.
 *
 * ── Currently inert, and kept on purpose ─────────────────────────────────────
 * Aura accepts no delivery direction, so this string no longer reaches a
 * synthesiser. It is still produced and still logged to `agent_runs`, for two
 * reasons: L4's prosody decision remains inspectable, which is what invariant
 * 14 (every turn replayable) is for; and the moment a TTS model that takes
 * direction is wired in, the thing to send is already being computed.
 *
 * Invariant 4 is unaffected either way — the blueprint never emits an emotion
 * tag, and L4 remains the only component permitted to originate one.
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

/**
 * Whether the active voice provider can produce the timings E2 needs.
 *
 * True on Deepgram. Kept as a live check rather than hardcoded so the day the
 * catalog changes, everything downstream of it changes with it instead of
 * disagreeing with it.
 */
export function voiceSupportsWordTimings(): boolean {
  return Boolean(VOICE_CATALOG[resolveVoiceProvider()].stt.wordTimestamps);
}
