/**
 * Writes to `agent_runs` — the table db-design.md §3.9 says to build on day one,
 * because it is how you answer "what does an interview actually cost" with data.
 *
 * Every write here is fire-and-forget and swallows its own errors. Logging must
 * never fail a user request, and `agent_runs` deliberately carries no foreign
 * keys so it can never take a lock on a table serving live traffic.
 */

import type { AgentId, AgentPhase, ProviderId, RunContext } from './types';
import { hasServiceRole } from '../supabase/admin';

export interface AgentRunRecord {
  agent: AgentId;
  phase: AgentPhase;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  audioSec?: number;
  costUsd?: number;
  ok: boolean;
  context?: RunContext;
  meta?: Record<string, unknown>;
}

export function recordAgentRun(record: AgentRunRecord): void {
  void writeAgentRun(record).catch(() => {
    /* swallowed on purpose — see file header */
  });
}

async function writeAgentRun(record: AgentRunRecord): Promise<void> {
  if (!hasServiceRole()) {
    // No service role configured (local dev without the key). Fall back to a
    // console line so cost is still visible while developing.
    if (process.env.NODE_ENV !== 'production') {
      const cost = record.costUsd !== undefined ? `$${record.costUsd.toFixed(6)}` : 'cost n/a';
      console.info(
        `[agent] ${record.agent} ${record.provider}:${record.model} ` +
          `${record.latencyMs}ms ${cost} ${record.ok ? 'ok' : 'FAILED'}`,
      );
    }
    return;
  }

  const { createAdminClient } = await import('../supabase/admin');
  const supabase = createAdminClient();

  await supabase.from('agent_runs').insert({
    user_id: record.context?.userId ?? null,
    project_id: record.context?.projectId ?? null,
    session_id: record.context?.sessionId ?? null,
    agent: record.agent,
    phase: record.phase,
    model: `${record.provider}:${record.model}`,
    latency_ms: record.latencyMs,
    input_tokens: record.inputTokens ?? null,
    output_tokens: record.outputTokens ?? null,
    audio_sec: record.audioSec ?? null,
    cost_usd: record.costUsd ?? null,
    ok: record.ok,
    meta: record.meta ?? {},
  });
}
