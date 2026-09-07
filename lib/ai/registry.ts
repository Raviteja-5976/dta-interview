/**
 * Provider registry — turns (agent) into a concrete, callable language model.
 *
 * Providers are constructed lazily and memoised, so an unset GOOGLE_… key costs
 * nothing until something actually asks for a Gemini model. That matters: today
 * only OPENAI_API_KEY is set, and the app must not throw at import time because
 * the other two are absent.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { createGroq } from '@ai-sdk/groq';
import type { LanguageModel } from 'ai';

import type { AgentId, ModelSpec, ProviderId } from './types';
import { PROVIDER_ENV_KEY, getModelSpec } from './catalog';
import { AGENT_POLICY, resolveModelOverride, resolveProvider, getPolicy } from './config';

type ProviderFactory = (modelId: string) => LanguageModel;

const factoryCache = new Map<ProviderId, ProviderFactory>();

export class MissingProviderKeyError extends Error {
  constructor(provider: ProviderId) {
    super(
      `No API key for provider "${provider}". Set ${PROVIDER_ENV_KEY[provider]} in .env.local, ` +
        `or point AI_PROVIDER at a provider you have configured.`,
    );
    this.name = 'MissingProviderKeyError';
  }
}

function buildFactory(provider: ProviderId): ProviderFactory {
  const apiKey = process.env[PROVIDER_ENV_KEY[provider]];
  if (!apiKey) throw new MissingProviderKeyError(provider);

  switch (provider) {
    case 'openai': {
      const p = createOpenAI({ apiKey });
      return (modelId) => p(modelId);
    }
    case 'google': {
      const p = createGoogleGenerativeAI({ apiKey });
      return (modelId) => p(modelId);
    }
    case 'xai': {
      const p = createXai({ apiKey });
      return (modelId) => p(modelId);
    }
    case 'groq': {
      const p = createGroq({ apiKey });
      return (modelId) => p(modelId);
    }
  }
}

function getFactory(provider: ProviderId): ProviderFactory {
  const cached = factoryCache.get(provider);
  if (cached) return cached;
  const factory = buildFactory(provider);
  factoryCache.set(provider, factory);
  return factory;
}

export interface ResolvedModel {
  provider: ProviderId;
  /** The concrete model id sent to the provider. */
  modelId: string;
  model: LanguageModel;
  /**
   * Catalog entry for the tier. When AI_MODEL_<AGENT> pins an off-catalog model
   * the spec still describes the tier, so cost figures become an estimate —
   * `isOverridden` marks that so `agent_runs` can be read with the right caveat.
   */
  spec: ModelSpec;
  isOverridden: boolean;
}

/** Resolve the model an agent should use right now, honouring all env overrides. */
export function resolveModelForAgent(agent: AgentId): ResolvedModel {
  const provider = resolveProvider(agent);
  const tier = getPolicy(agent).tier;
  const spec = getModelSpec(provider, tier);

  const override = resolveModelOverride(agent);
  const modelId = override ?? spec.id;

  return {
    provider,
    modelId,
    model: getFactory(provider)(modelId),
    spec,
    isOverridden: override !== undefined,
  };
}

/** True when the provider an agent would use has its key configured. */
export function isAgentRunnable(agent: AgentId): boolean {
  return Boolean(process.env[PROVIDER_ENV_KEY[resolveProvider(agent)]]);
}

/**
 * Snapshot of active routing — surfaced by GET /api/ai/status so you can see at
 * a glance which model every agent is on without reading env vars off a box.
 */
export function describeRouting(): Array<{
  agent: AgentId;
  provider: ProviderId;
  tier: string;
  model: string;
  overridden: boolean;
  configured: boolean;
}> {
  const agents = Object.keys(AGENT_POLICY) as AgentId[];
  return agents.map((agent) => {
    const provider = resolveProvider(agent);
    const tier = getPolicy(agent).tier;
    const override = resolveModelOverride(agent);
    return {
      agent,
      provider,
      tier,
      model: override ?? getModelSpec(provider, tier).id,
      overridden: override !== undefined,
      configured: Boolean(process.env[PROVIDER_ENV_KEY[provider]]),
    };
  });
}
