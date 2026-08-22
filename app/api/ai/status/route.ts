/**
 * GET /api/ai/status
 *
 * Which model every agent is currently routed to. Exists so you can answer
 * "what is P6 running on right now" without SSH-ing to a box and reading env
 * vars, and so a provider switch can be verified after deploy.
 */

import { describeRouting } from '@/lib/ai/registry';
import { AGENT_POLICY } from '@/lib/ai/config';
import { CATALOG, VOICE_CATALOG, VOICE_ENV_KEY } from '@/lib/ai/catalog';
import { resolveVoiceProvider, voiceConfigured } from '@/lib/ai/voice';
import { checkCodeRunner } from '@/lib/execution/health';
import { requireUser } from '@/lib/supabase/server';
import { handleRouteError, ok } from '@/lib/api/respond';
import type { AgentId } from '@/lib/ai/types';

export async function GET() {
  try {
    // Routing reveals infrastructure detail; keep it behind auth.
    await requireUser();

    const routing = describeRouting().map((row) => {
      const policy = AGENT_POLICY[row.agent as AgentId];
      const spec = CATALOG[row.provider][policy.tier];

      return {
        ...row,
        phase: policy.phase,
        timeoutMs: policy.timeoutMs,
        maxRetries: policy.maxRetries,
        // What actually controls this model, rather than what was configured.
        // On reasoning models `temperature` is discarded and `reasoningEffort`
        // is the live dial, so showing both prevents a false read.
        control: spec.supportsReasoningEffort
          ? { kind: 'reasoning', effort: policy.reasoningEffort, verbosity: policy.textVerbosity }
          : { kind: 'sampling', temperature: policy.temperature },
        pricePer1M: { input: spec.pricing.input, output: spec.pricing.output },
        rationale: policy.rationale,
      };
    });

    const voiceProvider = resolveVoiceProvider();
    const voice = VOICE_CATALOG[voiceProvider];

    // Live ping, not a env-var read. This is the endpoint you hit after moving
    // Judge0 to a new host, so it has to fail the same way the interview would.
    const codeRunner = await checkCodeRunner();

    return ok({
      defaultProvider: process.env.AI_PROVIDER ?? 'openai',
      agents: routing,
      unconfigured: routing.filter((r) => !r.configured).map((r) => r.agent),

      voice: {
        provider: voiceProvider,
        envKey: VOICE_ENV_KEY[voiceProvider],
        configured: voiceConfigured(),
        stt: voice.stt,
        tts: voice.tts,
        /*
         * The single most important flag on this endpoint. If word timestamps are
         * unavailable, E2 cannot compute the pause profile for ANY answer — it is
         * reported as unavailable rather than wrong, but that half of the delivery
         * panel goes dark.
         *
         * True on Deepgram, which is most of why it is the voice provider.
         */
        wordTimestampsAvailable: Boolean(voice.stt.wordTimestamps),
        /*
         * Both legs stream. STT runs on a WebSocket the BROWSER holds, so the
         * transcript arrives while the candidate is still talking; TTS streams
         * its response body so the interviewer starts speaking on the first MP3
         * frames rather than the last.
         */
        streaming: { stt: Boolean(voice.stt.streaming), tts: Boolean(voice.tts.streaming) },
        /*
         * Aura takes no delivery direction, so L4's prosody currently shapes
         * only the WORDS, not how they sound. Surfaced rather than left to be
         * discovered — a report that says the interviewer adapts its delivery
         * should be checkable against whether it actually can.
         */
        prosodyDirectionSupported: Boolean(voice.tts.supportsInstructions),
      },

      /*
       * `reachable: false` means the coding round will still run but produce no
       * test_pass_rate — half the coding score, reported as unavailable. A
       * language whose `resolvesTo` is null or names the wrong runtime is worse:
       * the round runs and grades against the wrong compiler.
       */
      codeRunner,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
