/**
 * Per-agent execution policy and provider resolution.
 *
 * Two things live here:
 *   1. Which capability tier each agent gets, and why (cost control happens here).
 *   2. How a provider is chosen at call time — globally or per agent.
 *
 * ── Switching providers ──────────────────────────────────────────────────────
 *   AI_PROVIDER=openai            # everything (default)
 *   AI_PROVIDER=google            # flip the whole system to Gemini
 *   AI_PROVIDER_P6=google         # ...or just the blueprint agent
 *   AI_MODEL_P6=gemini-3.1-pro    # escape hatch: pin one agent to an exact model
 *
 * Overrides are read per call, so nothing needs a redeploy to move.
 */

import type { AgentId, AgentPolicy, ModelTier, ProviderId } from './types';
import { isProviderId } from './catalog';

/**
 * Tier assignment. The comment on each line is the cost argument, because that
 * is the thing most likely to be revisited.
 *
 * Only two agents sit on `deep`, and both for the same reason: they generate
 * artifacts that everything downstream is graded against, so an error there is
 * not a slightly worse interview — it is a wrong one. Everything else runs on the
 * cheap tier, which is affordable precisely because those artifacts are good.
 *
 * Rough per-session shape on OpenAI, at the ladder in catalog.ts:
 *   P6 blueprint (deep)          ~$0.13   ← largest single call
 *   P7 challenges (deep, 1-3)    ~$0.19   only when a module is on
 *   SV skill review (deep, 1-3)  ~$0.06   only when the skill module is on
 *   E4 grading (~15 calls)       ~$0.03
 *   IV interviewer (~25 calls)   ~$0.02   on Groq, not OpenAI
 *   E5 + E6                      ~$0.04
 *   STT + TTS                    ~$0.07
 *   ────────────────────────────────────
 *   ~$0.30 plain · ~$0.50 with coding, against ~$0.85 of revenue.
 * Treat those as estimates, and read `agent_runs` for the real numbers.
 */
export const AGENT_POLICY: Record<AgentId, AgentPolicy> = {
  // ── Phase 1 · Preparation ─────────────────────────────────────────────────
  P1: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 45_000,
    maxRetries: 1,
    temperature: 0.2,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 3_000,
    rationale:
      'Reads a company site and synthesises a profile. Results are cached in company_cache and shared across every user interviewing there, so the cost amortises hard.',
  },
  P2: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 40_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 6_000,
    rationale:
      'Not flat extraction — it has to spot which claims are worth probing, which is judgement. Runs once per resume version.',
  },
  P3: {
    tier: 'nano',
    phase: 'prep',
    timeoutMs: 30_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 4_000,
    rationale:
      'Structural extraction from a job posting. agentdesign.md rates it Haiku/Flash-class; the cheapest tier handles it.',
  },
  P4: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 40_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'medium',
    textVerbosity: 'low',
    maxOutputTokens: 6_000,
    rationale:
      'Joins resume x JD x company and ranks what the interview must investigate. Everything downstream inherits its ranking.',
  },
  P5: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 40_000,
    maxRetries: 1,
    temperature: 0.4,
    reasoningEffort: 'medium',
    textVerbosity: 'low',
    maxOutputTokens: 4_000,
    rationale: 'Decides interview shape: time allocation, difficulty ramp, stop rules. Small output, high leverage.',
  },
  /**
   * P6 · One call per SECTION, not per blueprint.
   *
   * ── Why these numbers came down ──────────────────────────────────────────
   * This used to be a single call at `high` effort with a 16k visible budget —
   * so 41k max output tokens including reasoning headroom, generated as one
   * sequential stream. It took two to four minutes and routinely blew the 180s
   * ceiling, which failed the whole session, because a timeout is deliberately
   * not retried (see isTransient in run.ts).
   *
   * p6-blueprint.ts now generates each section independently and in parallel,
   * so this budget describes ONE section: a few goals with their evidence,
   * rubrics and seed questions. `medium` is the right effort for that — the
   * schema does most of the constraining, and the reasoning that `high` bought
   * was mostly spent holding seven sections in mind at once, which is no longer
   * the task.
   *
   * Still `deep`. Per-section quality is what all ~25 live turns navigate and
   * what the whole evaluation phase grades against, and the tier is now paid
   * for a fraction of the tokens.
   */
  P6: {
    tier: 'deep',
    phase: 'prep',
    // Per section. Several run concurrently alongside P7 and SC, so this allows
    // sufficient headroom under provider latency and network load (matching P7/SC at 150s).
    timeoutMs: 150_000,
    maxRetries: 1,
    temperature: 0.4,
    /*
     * `low`, measured rather than guessed: at `medium` a single section was
     * taking 56 seconds, which is most of the remaining critical path.
     *
     * The reasoning budget is not doing much work here any more. A section call
     * is handed the gap report, the section's purpose, what the other sections
     * cover and a schema that dictates the shape of the answer — the deliberation
     * `medium` paid for was largely spent rediscovering constraints that are now
     * supplied. `low` still allows 8k thinking tokens, which is ample for two or
     * three goals.
     *
     * This is the first dial to turn back if rubric quality ever looks thin;
     * AI_TIMEOUT_P6 and AI_MODEL_P6 move it without a deploy.
     */
    reasoningEffort: 'low',
    // Visible-output budget only — run.ts adds the reasoning headroom on top.
    maxOutputTokens: 5_000,
    textVerbosity: 'medium',
    rationale:
      'One call per conversational section, all in parallel. Produces the goals, evidence, rubrics and seed questions that every live turn navigates and the evaluation phase grades against. The intro, module and closing sections are built in code and cost nothing.',
  },
  P7: {
    tier: 'deep',
    phase: 'prep',
    timeoutMs: 150_000,
    maxRetries: 1,
    temperature: 0.4,
    reasoningEffort: 'high',
    // Three languages of starter code, hidden tests and a reference solution.
    maxOutputTokens: 10_000,
    textVerbosity: 'medium',
    rationale:
      'On `deep` at `high` for one specific reason: it has to write hidden test cases whose expected values are arithmetically correct for its own reference solution. A wrong expected value fails a candidate whose code was right — the worst defect this system can ship, and exactly the kind of careless arithmetic a cheap model produces. Only runs when the coding module is enabled.',
  },

  /**
   * SC · The skill challenge. Split out of P7, and the split is the point.
   *
   * P7's `high` effort is bought for one thing: hidden test cases whose expected
   * values must be arithmetically correct for its own reference solution. The
   * skill challenge has NO hidden tests — it is reviewed by SV against written
   * requirements — so that budget was paying for nothing here, and 25k of
   * reasoning headroom on top of a 10k output reliably ran past the 120s ceiling
   * and failed. The candidate then had a skill section with no task in it, on a
   * module they had already been charged for.
   *
   * `medium` is right for the work that remains: write a task, plant one real
   * bug where the format calls for it, and list what a correct answer does.
   * Still `deep`, because a debug task whose planted fault is not actually a
   * fault wastes the whole round.
   */
  SC: {
    tier: 'deep',
    phase: 'prep',
    timeoutMs: 150_000,
    maxRetries: 1,
    temperature: 0.4,
    reasoningEffort: 'medium',
    maxOutputTokens: 8_000,
    textVerbosity: 'medium',
    rationale:
      'One call per skill task. Writes the prompt, the starter code, the reference solution and the requirements SV later grades against. No hidden tests to compute, so it does not need P7\'s reasoning budget.',
  },

  // ── Phase 2 · Live loop ───────────────────────────────────────────────────
  //
  // Three agents, and only ONE of them is inside the turn.
  //
  // §10 budgeted 550ms for deciding and 350ms for wording, assuming the app sat
  // next to the provider. From a machine in India to OpenAI the network round
  // trip alone ate most of that, and a permanent fallback is worse than a slower
  // turn — it silently removes all adaptivity while still looking like it works.
  // That is why the live decision moved to Groq (see IV below): the fix for a
  // latency budget is a faster provider, not a lower ceiling.
  //
  // L2 and L3 never block. Both run alongside the turn and are collected after.
  L2: {
    tier: 'nano',
    phase: 'live',
    timeoutMs: 8_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 1_500,
    rationale: 'Async and off the critical path by design. Never blocks a turn, so it gets the cheapest tier and a generous timeout.',
  },
  L3: {
    tier: 'nano',
    phase: 'live',
    // Launched BEFORE the interviewer and collected after it, so its budget is
    // that call's. At 2s it lands inside the window and adds no wall clock to
    // the turn; past it, the turn proceeds on the lexical marks alone.
    timeoutMs: 2_000,
    maxRetries: 0,
    temperature: 0,
    reasoningEffort: 'none',
    textVerbosity: 'low',
    maxOutputTokens: 600,
    rationale:
      'Decides which evidence items an answer actually established — the number the whole report is built from, and the input that decides whether a goal stays open. Runs concurrently with the interviewer so it is free in wall-clock terms, and on the cheapest tier because the task is bounded: it rules on at most 8 ids it was handed, against one answer, with no reasoning budget.',
  },

  /**
   * IV · The live interviewer. Decides what to ask AND says it, in one call.
   *
   * ── Why this is one agent and not L1 + L4 ────────────────────────────────
   * D2/D3 split deciding from wording on the argument that a model asked to
   * reason about evidence coverage and simultaneously produce warm phrasing
   * does neither well. That held when both halves were Haiku-class and neither
   * could see the conversation.
   *
   * It stops holding for the behaviour that matters most here. When a candidate
   * answers a question with a question — "which Spark do you mean?" — the reply
   * has to come from whatever is holding the conversation. Split across two
   * agents, the one that can see what was said does not decide, and the one
   * that decides cannot see it. One call, one round trip, and the turn keeps
   * its latency budget.
   *
   * Invariant 14 survives: it emits the structured decision AND the utterance
   * in one object, so a turn is still replayable from what was logged.
   *
   * ── Why Groq ─────────────────────────────────────────────────────────────
   * This call sits in the silence after the candidate stops talking, which is
   * the whole of what makes a voice agent feel alive or dead. Nothing else in
   * the system is latency-bound like this, and nothing else is pinned to a
   * provider.
   */
  IV: {
    tier: 'balanced',
    phase: 'live',
    provider: 'groq',
    // Generous next to L1's old 1.2s because this call now does BOTH jobs and
    // writes a real sentence. The fallback is a rule-layer question, which is
    // legal and on-topic but not adaptive — so it is worth waiting a beat for
    // the real thing rather than falling back eagerly.
    timeoutMs: 4_000,
    maxRetries: 0,
    temperature: 0.6,
    // Selection and wording, not deliberation. Reasoning tokens here would be
    // spent inside the candidate's silence and read by nobody.
    reasoningEffort: 'none',
    maxOutputTokens: 700,
    rationale:
      'One call per turn, ~25 per interview, and the only model call inside the turn. On gpt-oss-120b it decides which goal to pursue, whether to dig into the last answer, and what to actually say — grounded in the blueprint context digest rather than in the resume, so the prompt stays constant-size however long the interview runs.',
  },


  // ── Phase 3 · Evaluation ──────────────────────────────────────────────────
  // temperature 0 throughout — but note it only takes effect on Gemini and Grok.
  // OpenAI's reasoning family ignores it, so score reproducibility there rests
  // on the two mitigations that do still hold: the rubric is written at plan
  // time and pinned to the question, and S1 computes every number by formula
  // from E4's observations. agentdesign.md §12 lists score drift as a tracked
  // risk; it is worth measuring rather than assuming.
  E3: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 45_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 3_000,
    rationale: 'Only runs for factual questions on versioned topics. Volatility routing keeps the call count low.',
  },
  E4: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 60_000,
    maxRetries: 2,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'low',
    maxOutputTokens: 4_000,
    rationale:
      'Roughly 15 parallel calls per session. The cheap tier is defensible here because the task is heavily scaffolded: P6 already wrote the rubric, the expected signals, and the literal phrases that count as covering each one, so E4 is matching an answer against a checklist rather than deciding what a good answer looks like. If grading quality ever looks thin, this is the first agent to promote — AI_PROVIDER_E4 or AI_MODEL_E4 moves it without a deploy.',
  },
  /**
   * SV · Reviews the skill-challenge submission against its requirements.
   *
   * The only evaluation agent on `deep`, and pinned to OpenAI rather than
   * following AI_PROVIDER. The coding round has a sandbox and does not need a
   * good model to know whether the tests passed; this round has no sandbox at
   * all, so the model IS the instrument, and its reading of the code is the
   * measurement.
   *
   * What a cheap model does here is specific and bad: it marks any solution
   * that does not resemble the reference solution as not meeting the
   * requirement. That fails candidates for solving the problem a different way,
   * which is the same class of defect as a wrong expected value in a hidden
   * test — a correct answer scored as wrong.
   *
   * At most three calls per session and only when the module is bought, so the
   * unit cost is affordable: roughly $0.03 a call against the module's 30
   * credits. `AI_MODEL_SV` reaches the frontier model for anyone A/B-ing it.
   */
  SV: {
    tier: 'deep',
    phase: 'eval',
    provider: 'openai',
    timeoutMs: 120_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'high',
    textVerbosity: 'medium',
    maxOutputTokens: 6_000,
    rationale:
      'Reads a React component, a SQL query or a debugged function against requirements written at plan time and decides which are met. No sandbox exists for this round, so quality here is the difference between a fair score and a coin flip.',
  },
  E5: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 60_000,
    maxRetries: 1,
    temperature: 0,
    reasoningEffort: 'low',
    textVerbosity: 'medium',
    maxOutputTokens: 4_000,
    rationale: 'The improved/ideal answer pair is the most-read part of the report. Cheapening this is visible to the user immediately.',
  },
  E6: {
    tier: 'balanced',
    phase: 'eval',
    timeoutMs: 90_000,
    maxRetries: 1,
    // Slightly above zero: this one writes prose, and 0 reads flat.
    temperature: 0.2,
    reasoningEffort: 'low',
    textVerbosity: 'medium',
    maxOutputTokens: 6_000,
    rationale: 'One call per session. Writes narrative only, from numbers S1 already computed — it never invents a score.',
  },

  // ── Ad hoc ────────────────────────────────────────────────────────────────
  /**
   * RI · Rewrites the whole resume for one posting.
   *
   * `medium` reasoning rather than `low`, which the bullet-suggestion version of
   * this agent used to run on. The job changed: it now has to decide, line by
   * line, whether the resume actually supports a claim or whether the honest
   * place for it is `cannot_claim_yet`. That judgement is the entire value of
   * the output, and a model not thinking about it defaults to flattering the
   * candidate — which produces a document that gets them into a room they
   * cannot then hold.
   *
   * Still `balanced`: user-initiated and infrequent, and a whole rewritten
   * resume is a long output that would be expensive on the deep tier for a
   * quality gain that has not been shown to exist. AI_MODEL_RI moves it.
   */
  RI: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 120_000,
    maxRetries: 1,
    temperature: 0.3,
    reasoningEffort: 'medium',
    textVerbosity: 'medium',
    maxOutputTokens: 14_000,
    rationale:
      'Rewrites an entire resume against one posting and decides what it cannot honestly claim. The most consequential thing this product hands a user — it goes to real employers with their name on it.',
  },

  /**
   * SP · The preparation timetable.
   *
   * Runs beside RI, and is the cheaper half: the calendar arithmetic it would
   * otherwise get wrong is done in lib/engine/prep-window.ts before the call, so
   * what is left is judgement about what to study and in what order. `medium`
   * because sequencing a plan around what is fixable in the time is the whole
   * task, and a model that does not weigh it produces an evenly-spread plan that
   * covers everything shallowly.
   */
  SP: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 120_000,
    maxRetries: 1,
    temperature: 0.3,
    reasoningEffort: 'medium',
    textVerbosity: 'medium',
    maxOutputTokens: 10_000,
    rationale:
      'One call per plan. Sequences the gap report against the days actually remaining, and picks the portfolio projects that fit. Never touches dates — the engine owns those.',
  },

  /**
   * TR · The resume the candidate is working towards.
   *
   * Runs after RI and SP because it consumes both — the claims RI could not
   * honestly make, and the projects SP scheduled to earn them.
   *
   * `medium` for one specific judgement: deciding, line by line, whether a claim
   * is already true or only becomes true after the work. Getting that wrong in
   * the permissive direction puts an unearned line into the document with no
   * marking on it, which is the one way this feature can actively harm someone.
   * Everything else about the output is ordinary resume prose.
   */
  TR: {
    tier: 'balanced',
    phase: 'prep',
    timeoutMs: 120_000,
    maxRetries: 1,
    temperature: 0.3,
    reasoningEffort: 'medium',
    textVerbosity: 'medium',
    maxOutputTokens: 14_000,
    rationale:
      'Projects the resume forward to where the prep plan leads, marking every line as already-true or yet-to-be-earned. Separate from RI so that "invent nothing" and "project forward" never share a prompt.',
  },
};

/** The system-wide default provider. `AI_PROVIDER` overrides it. */
const DEFAULT_PROVIDER: ProviderId = 'openai';

/**
 * Resolve which provider handles a given agent.
 * Precedence: per-agent env override → global env → compiled default.
 */
export function resolveProvider(agent: AgentId): ProviderId {
  const perAgent = process.env[`AI_PROVIDER_${agent}`];
  if (perAgent && isProviderId(perAgent)) return perAgent;

  /*
   * An agent's own provider outranks the global switch, and deliberately so.
   * `AI_PROVIDER` is a statement about where the reasoning work should run; an
   * agent that pins itself has a requirement that does not move when that
   * preference does. Only AI_PROVIDER_<AGENT> overrides it.
   */
  const pinned = AGENT_POLICY[agent].provider;
  if (pinned) return pinned;

  const global = process.env.AI_PROVIDER;
  if (global && isProviderId(global)) return global;

  return DEFAULT_PROVIDER;
}

/**
 * Escape hatch: pin one agent to an exact model id, bypassing the tier system.
 * Useful for A/B testing a new model without editing the catalog.
 */
export function resolveModelOverride(agent: AgentId): string | undefined {
  return process.env[`AI_MODEL_${agent}`] || undefined;
}

/**
 * Policy for an agent, with the timeout resolved against `AI_TIMEOUT_<AGENT>`.
 *
 * Timeouts are the one policy field worth tuning per deployment rather than per
 * codebase: the right value depends on how far the app sits from the provider,
 * and that changes between a laptop and production without a line of code
 * changing. The live-loop agents are the ones this actually matters for.
 */
export function getPolicy(agent: AgentId): AgentPolicy {
  const base = AGENT_POLICY[agent];
  const override = Number(process.env[`AI_TIMEOUT_${agent}`]);

  if (Number.isFinite(override) && override > 0) {
    return { ...base, timeoutMs: override };
  }
  return base;
}

export function getTier(agent: AgentId): ModelTier {
  return AGENT_POLICY[agent].tier;
}
