# DevTrackAcademy — Interview Engine Agent Design

**Version:** 2.0
**Scope:** Voice mock-interview engine (resume + JD + company URL → goal-driven adaptive interview → evidence-based report)
**Architecture stance:** deterministic orchestration, conversational intelligence, reproducible evaluation.

---

## 0. Design decisions

Nine decisions define this architecture. Each is recorded with the problem it solves, what a naive design does instead, and what the change buys. Everything in the rest of the document follows from these.

---

### D1 · The Blueprint defines goals, not a script

**Problem.** A blueprint that emits an ordered list of questions produces an interview that walks the list. Follow-ups soften this but do not fix it: the spine of the conversation is still a sequence decided before the candidate said a word. Real interviewers do not carry a list. They carry a set of things they need to find out, and they navigate toward them using whatever the candidate just said as the road.

**Old.**

```
Blueprint → [ Q1, Q2, Q3, Q4, Q5 ] → ask in order, allow ≤2 follow-ups each
```

**New.**

```
Blueprint → Section Goals
              ├── evidence_required     (what must be established)
              ├── completion_criteria   (when this goal is satisfied)
              ├── exit_conditions       (when to abandon it)
              ├── question_bank         (many ways in, no order)
              ├── followup_bank         (probes per concept)
              └── transition_examples   (how to enter and leave)
```

**Why.** A goal is a destination; a question is a route. Fixing the route at plan time throws away the only information that makes an interview adaptive — what the candidate actually says. Separating the two lets the plan stay stable and reproducible while the path through it varies per candidate.

**Benefits.**
- The interview cannot sound scripted, because there is no script to read.
- The same blueprint serves a candidate who answers everything in one breath and one who needs six probes — neither runs out of questions or gets dragged through irrelevant ones.
- Evidence-based section completion becomes possible (see D5), because the blueprint now states what evidence looks like.
- Reproducibility is preserved: the goals, banks, and rubrics are still generated once, before the interview, and are still logged with the session.

**The GPS analogy is the design contract.** The Blueprint sets the destination. The Conversation Manager picks the route. The Orchestrator enforces the fuel budget.

---

### D2 · The Probe Decision Agent becomes a Conversation Manager

**Problem.** A four-way switch (`FOLLOW_UP` / `NEXT` / `CORRECT` / `END_SECTION`) is a turn-taking policy, not an interviewer. It cannot decide to change subject because the current one is exhausted, to reach back to something said eleven minutes ago, to soften because the candidate is visibly struggling, or to raise difficulty because the last three answers were strong. Every one of those is a routine human interviewer behaviour and none of them fit in the switch.

**Old.**

```
answer → Probe Decision Agent → one of four actions → orchestrator acts
```

**New.**

```
answer → Evidence Tracker + Interview Memory updated
            ↓
       Conversation Manager → structured conversational intent
            { action, target_goal, target_skill, missing_evidence,
              transition_type, emotional_tone, callback_memory,
              response_strategy, difficulty_delta }
            ↓
       Dialogue Styler → utterance plan
```

**Why.** The decision an interviewer makes each turn is multi-dimensional: what to pursue, why, how hard, in what tone, and how to get there from here. Compressing that into one enum loses everything except "what next".

**Benefits.**
- Every dimension of the decision becomes inspectable and testable in isolation.
- Emotional handling stops being an accident of prompt wording and becomes an explicit field.
- Callbacks become a first-class action rather than a lucky follow-up.
- The output is structured intent, never prose — so the Conversation Manager can be swapped, evaluated, or A/B tested without touching how anything is said.

---

### D3 · Wording is separated from deciding — the Dialogue Styler

**Problem.** In the old design, the agent that decided *what* to ask also produced the *sentence*. That conflation has two costs. First, a model asked to reason about evidence coverage and simultaneously produce warm natural phrasing does neither well. Second, the same question can only be delivered one way, so an interviewer sounds identical whether the candidate is cruising or drowning.

**Old.**

```
Probe Agent → "You mentioned Redis — how did you handle invalidation?"  (decision AND wording)
```

**New.**

```
Conversation Manager → { action: FOLLOW_UP, target_skill: "redis",
                         missing_evidence: ["invalidation strategy"],
                         emotional_tone: "encouraging",
                         response_strategy: "scaffold" }
            ↓
Dialogue Styler   → { acknowledgement: "Okay, that makes sense.",
                      transition: "Let's stay on that for a second —",
                      utterance: "when a cached value changed, how did you
                                  make sure the stale one didn't get served?",
                      prosody: { rate: 0.95, pauses: [...], emphasis: [...] } }
```

**Why.** *What to ask* is a reasoning problem over evidence. *How to say it* is a delivery problem over emotional context. They have different inputs, different failure modes, different latency profiles, and different models suit them.

**Benefits.**
- Identical interview substance, different human texture, per candidate state.
- All TTS emotion, pacing, and emphasis tags originate in exactly one place. The Blueprint never emits emotion tags; the Conversation Manager never emits sentences.
- Interviewer personality becomes a configuration input, not a prompt rewrite.
- The Styler is small and fast, so adding it costs little on the critical path.

---

### D4 · Structured Interview Memory replaces topic extraction

**Problem.** A flat list of "topics the candidate mentioned" supports one behaviour: a callback. It cannot tell you that a claim is unverified, that a metric was quoted without a baseline, that a project was described twice inconsistently, or that a leadership story is available for the behavioural section. Those are the things a human interviewer is actually holding in their head.

**Old.**

```json
{ "topics": [ { "topic": "AI chatbot with LangChain", "callback_question": "…" } ] }
```

**New.** A typed, persistent memory store with fourteen item kinds — `project`, `technology`, `claim`, `metric`, `achievement`, `weakness`, `strong_answer`, `unverified_claim`, `story`, `leadership_example`, `behavioral_example`, `architecture_discussion`, `coding_hint`, `company_specific` — each carrying `confidence`, `source_question_id`, `importance`, `related_skills`, and `callback_candidates`.

**Why.** Memory is not a transcript and it is not a topic list. It is the interviewer's working model of the person in front of them, and every downstream decision reads from it: what to probe, what to callback, what to grade as inconsistent, what to put in the report.

**Benefits.**
- Callbacks become specific: *"Earlier you mentioned deploying with ECS — how did you handle rolling updates?"* rather than *"Tell me about deployment."*
- Unverified claims are tracked as a queue, so the interview can close them out deliberately instead of by luck.
- Contradictions surface during the interview rather than confusing the grader afterwards.
- The evaluation phase inherits a structured record rather than re-deriving it from raw text.

---

### D5 · Evidence Coverage Tracker replaces question counting

**Problem.** The old orchestrator ended a section when the question count or the time budget ran out. That is bookkeeping, not interviewing. A real interviewer does not think *"I have asked six questions"*; they think *"I still have not established whether this person has actually touched Kubernetes."*

**Old.**

```python
if questions_asked >= section.max_questions: advance_section()
```

**New.**

```python
if evidence_tracker.goal_satisfied(goal_id): close_goal(goal_id)
if evidence_tracker.section_complete(section_id): advance_section()
# time and question budgets remain, but as CEILINGS, not as the primary rule
```

**Why.** Sections should end because they are *done*, not because a counter tripped. Otherwise you get both failure modes at once: a section that stops before the important thing is established, and a section that keeps asking after it already knows.

**Benefits.**
- The interview allocates its time where evidence is actually missing.
- The Conversation Manager gets a precise, cheap answer to "what am I still missing?" — the single most useful input it has.
- Report skill-verification claims are grounded in a live coverage record, not reconstructed after the fact.
- Sections end naturally, which is a large part of why the conversation feels human.

---

### D6 · The live loop is conversation-first

**Old.**

```
Blueprint ──▶ Voice Agent ──▶ Probe Agent ──▶ Voice Agent
```

The Voice Agent was the centre of gravity and the Probe Agent a bolt-on.

**New.**

```
Blueprint (goals)
   ↓
Interview Memory  ─┐
Evidence Tracker  ─┴─▶ Conversation Manager ──▶ Dialogue Styler ──▶ Voice Agent
```

**Why this feels significantly more human.** Four reasons, and they compound.

1. **The system knows what it is missing before it decides what to say.** The Evidence Tracker updates on answer ingest, so the Conversation Manager's first input is an accurate gap list. Human interviewers do exactly this — they listen, update their model, then decide.
2. **The system remembers specifically.** Because memory is typed, a callback names the thing. Specific recall is the strongest signal of attention that exists in conversation, and it is the single behaviour that makes people say an interviewer "was really listening".
3. **The decision carries emotional context, and something downstream acts on it.** The Conversation Manager judges the candidate's state; the Styler renders it. Warmth stops being random.
4. **Nothing in the loop is reading from a list.** Questions are selected against live evidence gaps, so the ordering emerges from the conversation. That is the difference between an interview and a questionnaire.

The deterministic parts do not move. The Orchestrator still owns state, budgets, and failure handling; it simply stopped pretending to be the interviewer.

---

### D7 · The voice layer is a cascaded pipeline, not speech-to-speech

**Problem.** A realtime speech-to-speech API is the obvious choice for a voice interviewer and the wrong one for *this* interviewer. Three reasons, in order of weight.

First, **the evaluation layer needs word-level timestamps.** E2's entire speech-metrics system — pace, pause profile, filler rate, repetition — is arithmetic over per-word timing. Speech-to-speech APIs return transcripts; they do not return reliable word-level timing. Bolting on a second ASR to recover it means paying twice and reconciling two clocks.

Second, **a realtime model paraphrases.** L1 selects a bank question whose rubric was generated at plan time. If the voice layer rewords it into something subtly different, the rubric is now grading an answer to a question that was never asked. In an architecture built on plan-time rubrics, an improvising mouth is a correctness bug.

Third, **the questions are known in advance.** P6 emits the entire question bank during preparation. That means most utterances can be **synthesized before the interview starts** and played from cache — which no speech-to-speech model can do, because it generates every utterance fresh.

**Old.**

```
L1 intent → L4 wording → Realtime speech-to-speech session (generates + speaks)
                          ├─ transcript without word timing
                          └─ fork candidate audio to a second ASR, reconcile clocks
```

**New.**

```
Phase 1:  P6 question bank ──▶ P8 Voice Asset Pre-synthesis
                                 └─ every bank question × tone variants → cached audio

Phase 2:  🎙 → Streaming STT (word timestamps) → Semantic EOU
                     ↓
              L3 · L2 · L1 · L4          ← the "LLM brain", already in the design
                     ↓
              L5: cached clip (≈0 ms)  OR  live TTS (≈200 ms)  → 🔊
```

**Why this fits the existing architecture rather than fighting it.** The document already separates *deciding* (L1) from *wording* (L4) from *speaking* (L5). A speech-to-speech model collapses all three into one opaque component, which is precisely what D2 and D3 exist to prevent. The cascade is the architecture the rest of this design was already describing.

**Benefits.**
- **Word-level timestamps are native.** No forked audio track, no second ASR bill, no clock reconciliation. E1 gets its timing directly from the STT that ran during the interview.
- **The interviewer says exactly what L4 wrote.** No paraphrase drift between the asked question and the rubric grading it.
- **Most turns have zero synthesis latency.** With the bank pre-synthesized, roughly 60–70% of utterances are cache hits, which more than pays for the second blocking model call added in D2/D3.
- **Cost drops by roughly 5–10×** against realtime audio-token pricing — which is what decides whether a free practice tier is viable.
- **Every component stays swappable.** STT, TTS, and the brain models are three independent choices, not one vendor decision.

**What you take on, and where it is handled.** End-of-utterance detection and barge-in become your problem rather than the vendor's. Both are addressed explicitly: semantic EOU with interview-tuned thresholds in L5, and `spoke_fully` truncation handling in L5 → E1. These are the two hardest parts of a cascaded stack and the design must not treat them as afterthoughts.

---

### D8 · Conversational rules are deterministic, not prompted

**Problem.** "Do not ask two similar questions in a row" and "do not repeat the same acknowledgement" are constraints, not judgements. Asking a model to remember them across twenty-five turns means they hold most of the time — and the failures are exactly the ones a listener notices.

**New.** A rule layer (§4) that runs in code, filters the Conversation Manager's candidate actions before the call, and validates its output after. Rules are enforced, not encouraged.

**Benefits.** Deterministic, testable, zero latency cost, and it shrinks the Conversation Manager's prompt — which makes the call both faster and better at the reasoning it is actually for.

---

### D9 · The Orchestrator stays a deterministic workflow engine

Unchanged, and now more important than in v1, because there are more moving parts to coordinate. Full rationale in §5. In short: routing is not intelligence, and the component that guarantees the interview terminates must not be the component that improvises.

---

### D10 · Everything below the live loop is preserved exactly

These were right in v1 and are carried forward unmodified:

- Rubrics generated at plan time, not after the interview.
- Four grading modes: `factual`, `experiential`, `behavioral`, `coding` — factual accuracy is never applied to the other three.
- Graders emit observations; the Scoring Engine emits numbers.
- Knowledge routing by volatility — stable fundamentals never trigger a web search.
- All evaluation runs post-interview, in batch.
- Speech metrics are deterministic arithmetic with band scoring and explicit fairness constraints.
- Every component has a defined failure fallback.

---

## 1. Component roster

Twenty-one components across four tiers. IDs are phase-prefixed so that inserting a component never renumbers another.

| ID | Name | Type | Phase | Model | MVP |
|---|---|---|---|---|---|
| **O1** | Interview Orchestrator | Service (FSM) | all | none | ✅ |
| **P1** | Company Research Agent | Tool-using Agent | prep | Flash/Sonnet-class | ⬜ |
| **P2** | Resume Parser Agent | Agent | prep | Sonnet-class | ✅ |
| **P3** | JD Parser Agent | Agent | prep | Haiku/Flash-class | ✅ |
| **P4** | Gap Analysis Agent | Agent | prep | Sonnet-class | ⬜ |
| **P5** | Interview Strategy Agent | Agent | prep | Sonnet-class | ⬜ |
| **P6** | Interview Blueprint Agent | Agent | prep | Opus/Sonnet-class | ✅ |
| **P7** | Coding Challenge Agent | Agent | prep | Sonnet-class | ⬜ |
| **P8** | Voice Asset Pre-synthesis | Service (deterministic) | prep | TTS engine | ✅ |
| **L1** | Conversation Manager | Agent (fast, blocking) | live | Haiku/Flash-class | ✅ |
| **L2** | Structured Interview Memory | Service + Agent (async) | live | Haiku/Flash-class | ✅ |
| **L3** | Evidence Coverage Tracker | Service (deterministic) | live | none | ✅ |
| **L4** | Dialogue Styler Agent | Agent (fast, blocking) | live | Haiku/Flash-class | ✅ |
| **L5** | Voice Interviewer | Pipeline (STT + TTS) | live | no LLM — brain is L1/L4 | ✅ |
| **E1** | Transcript Assembly Service | Service | eval | none | ✅ |
| **E2** | Speech Metrics Service | Service | eval | none | ✅ |
| **E3** | Evidence & Knowledge Router | Tool-using Agent | eval | Sonnet-class | ⬜ |
| **E4** | Answer Grading Agent | Agent | eval | Sonnet-class | ✅ |
| **E5** | Rewrite Coach Agent | Agent | eval | Sonnet-class | ✅ |
| **E6** | Report Composer | Agent + Service | eval | Sonnet-class | ✅ |
| **S1** | Scoring Engine | Service (deterministic) | eval | none | ✅ |

### One-line responsibilities

**Orchestration**

- **O1 · Interview Orchestrator** — deterministic state machine. Owns session state, sequences the phase pipeline, enforces time and turn ceilings, dispatches every component, applies failure fallbacks. Contains zero LLM calls and makes zero interview decisions.

**Phase 1 · Preparation**

- **P1 · Company Research Agent** — reads the company site and a couple of searches; emits a structured company profile with confidence and sources.
- **P2 · Resume Parser Agent** — resume → structured JSON, with emphasis on *claims worth probing* rather than a flat skill list.
- **P3 · JD Parser Agent** — job description → required vs preferred skills, seniority, responsibilities, and implicit expectations.
- **P4 · Gap Analysis Agent** — joins resume × JD × company; classifies every skill and ranks what the interview must investigate.
- **P5 · Interview Strategy Agent** — decides the *shape*: time allocation, priority skills, difficulty ramp, evidence depth targets, stop rules.
- **P6 · Interview Blueprint Agent** — converts strategy into **goals**: evidence requirements, completion criteria, exit conditions, question banks, follow-up banks, transition examples, and the grading rubric for every bank entry.
- **P7 · Coding Challenge Agent** — selects or adapts the coding/architecture problem, with starter code, hidden tests, and escalating hints.
- **P8 · Voice Asset Pre-synthesis** — renders every bank question, transition, and acknowledgement to audio before the interview starts, in each tone variant. Turns most live turns into a cache lookup instead of a synthesis call.

**Phase 2 · Live interview**

- **L1 · Conversation Manager** — the interviewer's judgement. Reads evidence gaps, memory, and conversational state; emits structured conversational intent. Never emits prose.
- **L2 · Structured Interview Memory** — the working model of the candidate. Typed, confidence-scored, updated after every answer, consumed by every downstream component.
- **L3 · Evidence Coverage Tracker** — deterministic ledger of which concepts are verified, at what depth, with what confidence, and what remains outstanding per goal.
- **L4 · Dialogue Styler Agent** — turns intent into an utterance plan: acknowledgement, transition, wording, prosody, emotion tags. The only source of TTS delivery instructions in the system.
- **L5 · Voice Interviewer** — the cascaded voice pipeline: streaming STT with word-level timestamps, semantic end-of-utterance detection, and TTS that plays a pre-synthesized clip when one exists and synthesizes live when it does not. Handles barge-in. Contains no model of its own and decides nothing.

**Phase 3 · Evaluation**

- **E1 · Transcript Assembly Service** — aligns word-level ASR timing to per-question answer segments; emits the canonical `question_record[]`.
- **E2 · Speech Metrics Service** — pure arithmetic over word timestamps: pace, pauses, fillers, repetition, with reliability gating.
- **E3 · Evidence & Knowledge Router** — for factual questions only, decides whether external verification is warranted and attaches citable evidence.
- **E4 · Answer Grading Agent** — compares answer to rubric; emits observations, never scores.
- **E5 · Rewrite Coach Agent** — the improved-version / ideal-version pair, plus the one highest-leverage change.
- **E6 · Report Composer** — assembles the final report; writes narrative sections only, from numbers it is given.
- **S1 · Scoring Engine** — converts observations and metrics into numbers by formula. No model involved.

---

## 2. Flow maps

### 2.1 Phase pipeline

```
╔═════════════════ PHASE 0 · INTAKE (sync, ~2s) ═══════════════════════════╗
║  resume.pdf  ·  job_description  ·  company_url                          ║
║  options: difficulty · coding_enabled · target_duration · language       ║
╚════════════════════════════════╤═════════════════════════════════════════╝
                                 ▼
                        ┌─────────────────┐
                        │ O1 ORCHESTRATOR │   state = PREPARING
                        └────────┬────────┘
╔═══════════════ PHASE 1 · PREPARATION (async, 30–90s) ════════════════════╗
║   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   ║
║   │ P1 Company   │  │ P2 Resume    │  │ P3 JD        │  ← PARALLEL       ║
║   │    Research  │  │    Parser    │  │    Parser    │                   ║
║   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                   ║
║          └─────────────────┼─────────────────┘                           ║
║                            ▼                                             ║
║                   ┌──────────────────┐                                   ║
║                   │ P4 Gap Analysis  │  ranked investigation plan        ║
║                   └────────┬─────────┘                                   ║
║                            ▼                                             ║
║                   ┌──────────────────┐                                   ║
║                   │ P5 Strategy      │  time · priorities · ramp         ║
║                   └────────┬─────────┘                                   ║
║                            ▼                                             ║
║              ┌───────────────────────────┐                               ║
║              │ P6 Interview Blueprint    │──┐ if coding_enabled          ║
║              │   GOALS · BANKS · RUBRICS │  ▼                            ║
║              └────────────┬──────────────┘  ┌──────────────────┐         ║
║                           │                 │ P7 Coding        │         ║
║                           └────────┬────────┤    Challenge     │         ║
║                                    ▼        └──────────────────┘         ║
║                       ┌──────────────────────────┐                       ║
║                       │ P8 Voice Asset           │  bank × tone variants ║
║                       │    Pre-synthesis (TTS)   │  → cached audio       ║
║                       └────────────┬─────────────┘                       ║
║                                    ▼                                     ║
║   [ GOAL GRAPH frozen · L3 seeded from goals · voice cache warm ]        ║
╚════════════════════════════════╤═════════════════════════════════════════╝
                                 │  state = READY → LIVE
                        ┌────────▼────────┐
                        │  §2.2 TURN CYCLE │
                        └────────┬────────┘
                                 │  state = EVALUATING
╔═════════════ PHASE 3 · EVALUATION (batch, async, 1–3 min) ═══════════════╗
║   ┌────────────────────────┐                                             ║
║   │ E1 Transcript Assembly │  raw ASR words + turn log → question_record[]║
║   └───────────┬────────────┘                                             ║
║               ├──────────────────────────┐                               ║
║               ▼                          ▼                               ║
║   ┌────────────────────────┐  ┌────────────────────────┐                 ║
║   │ E2 Speech Metrics      │  │ E3 Evidence &          │                 ║
║   │    (no LLM)            │  │    Knowledge Router    │ factual only    ║
║   └───────────┬────────────┘  └───────────┬────────────┘                 ║
║               │                           ▼                              ║
║               │              ┌────────────────────────┐                  ║
║               │              │ E4 Answer Grading      │ map-reduce       ║
║               │              │   (observations only)  │ per question     ║
║               │              └───────────┬────────────┘                  ║
║               └──────────────┬───────────┘                               ║
║                              ▼                                           ║
║                  ┌────────────────────────┐                              ║
║                  │ S1 SCORING ENGINE      │  §9 formulas, deterministic  ║
║                  └───────────┬────────────┘                              ║
║                              ▼                                           ║
║                  ┌────────────────────────┐                              ║
║                  │ E5 Rewrite Coach       │  scores < 8.5 only           ║
║                  └───────────┬────────────┘                              ║
║                              ▼                                           ║
║                  ┌────────────────────────┐                              ║
║  L2 memory ─────▶│ E6 Report Composer     │ → final_report.json          ║
║  L3 coverage ───▶└────────────────────────┘                              ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### 2.2 The live turn cycle — conversation-first

This is the heart of the system. Read it as one loop, executed once per candidate answer.

```
                              🎙  candidate speaks
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │ L5 VOICE INTERVIEWER          │
                        │  streaming STT · semantic EOU │
                        │  word timestamps · barge-in   │
                        └───────────────┬───────────────┘
                                        │ answer + transcript + timing
                                        ▼
                        ┌───────────────────────────────┐
                        │ O1 ORCHESTRATOR               │
                        │  ingest turn · stamp · persist│
                        └───────┬───────────────┬───────┘
                                │               │
        ┌───────────────────────┘               └───────────────────────┐
        ▼  BLOCKING · <40ms                          ASYNC · off-path   ▼
┌────────────────────────┐                            ┌────────────────────────┐
│ L3 EVIDENCE TRACKER    │                            │ L2 INTERVIEW MEMORY    │
│  fast lexical/embedding│                            │  typed extraction      │
│  match vs rubric       │◀── async refinement ───────│  projects · claims ·   │
│  → concepts_verified   │                            │  metrics · stories …   │
│  → concepts_missing    │                            └───────────┬────────────┘
│  → goal_satisfied?     │                                        │
└───────────┬────────────┘                                        │
            │                                                     │
            │        ┌────────────────────────────────────────────┘
            ▼        ▼
┌──────────────────────────────────────────────────────────────┐
│ §4 CONVERSATION RULES  (deterministic pre-filter)            │
│  strips illegal candidate actions before the model sees them │
│  · no consecutive similar questions   · no abrupt switches   │
│  · acknowledgement not reused         · difficulty ≤ +1 step │
└───────────────────────────┬──────────────────────────────────┘
                            ▼  BLOCKING · ≤350ms
            ┌───────────────────────────────────┐
            │ L1 CONVERSATION MANAGER           │
            │  reads: goals · gaps · memory ·   │
            │         rhythm · candidate state  │
            │  emits: CONVERSATIONAL INTENT     │
            │  { action, target_goal,           │
            │    target_skill, missing_evidence,│
            │    transition_type, emotional_tone│
            │    callback_memory,               │
            │    response_strategy,             │
            │    difficulty_delta }             │
            └───────────────┬───────────────────┘
                            ▼
            ┌───────────────────────────────────┐
            │ §4 RULES  (post-validation)       │
            │  reject + resample illegal intent │
            └───────────────┬───────────────────┘
                            ▼  BLOCKING · ≤200ms  (speculatively pre-warmed)
            ┌───────────────────────────────────┐
            │ L4 DIALOGUE STYLER                │
            │  intent + tone + stage + persona  │
            │  → UTTERANCE PLAN                 │
            │  { acknowledgement, transition,   │
            │    utterance, prosody, emotion }  │
            └───────────────┬───────────────────┘
                            ▼
            ┌───────────────────────────────────┐
            │ L5 VOICE INTERVIEWER  🔊          │
            │  P8 cached clip (~0ms)            │
            │  or live TTS (~200ms)             │
            │  speaks the plan · nothing else   │
            └───────────────────────────────────┘
                            │
                            └────────▶ loop
```

**Read the vertical axis as responsibility, not just sequence.** L3 answers *what is still missing*. L2 answers *what do I know about this person*. L1 answers *what should I do about it*. L4 answers *how should that sound*. L5 answers *say it*. No component answers two of those questions, and that separation is what makes each one testable.

### 2.3 Dependency rules

| Rule | Reason |
|---|---|
| P1, P2, P3 run in parallel; P4 waits on all three | Cuts prep from ~60s to ~25s |
| P4 → P5 → P6 strictly sequential | Each narrows the decision space of the next |
| P6 must emit goals, banks **and** rubrics before LIVE | Post-interview grading must be cheap and reproducible |
| L3 is seeded from P6's `evidence_required` at session start | The tracker's schema *is* the blueprint's evidence contract |
| L3 updates before L1 is called, every turn | The Conversation Manager's first input must be an accurate gap list |
| L2 updates asynchronously, never blocking | Memory pays off from the *next* turn onward; blocking on it doubles turn latency for nothing |
| §4 rules filter L1's action space **before** the call and validate **after** | Constraints belong in code; judgement belongs in the model |
| L1 emits intent only; L4 emits words only | Neither can silently take over the other's job |
| P8 runs after P6 (and P7) and must complete before READY | A cold voice cache means every turn pays live TTS latency |
| L5 never calls P1–P8 or E1–E6 | The live loop stays inside its latency budget |
| L5's STT must emit word-level timestamps | E2's entire metrics layer is arithmetic over them. This is a hard vendor requirement, not a preference |
| L1 and L4 are the **only** blocking model calls in the loop | Everything else is deterministic or queued |
| E1 completes before E2/E3/E4 | They all read `question_record[]` |
| E4 emits observations; S1 emits numbers | Reproducibility, and weights retunable without re-running models |
| E6 reads L2 and L3 directly | Skill-verification claims in the report come from the live coverage ledger, not re-derivation |

---

## 3. Data contracts

Six objects. Every agent reads and writes slices of these and nothing else.

### 3.1 `session` — owned by O1

```json
{
  "session_id": "ses_01H...",
  "candidate_id": "usr_01H...",
  "state": "INTAKE | PREPARING | READY | LIVE | EVALUATING | COMPLETE | FAILED",
  "created_at": "2026-08-07T09:00:00Z",

  "inputs": {
    "resume_file_url": "s3://.../resume.pdf",
    "jd_text": "…",
    "company_url": "https://stripe.com",
    "difficulty": "medium",
    "coding_enabled": true,
    "target_duration_min": 15,
    "language": "en-IN",
    "interviewer_persona": "warm_professional"
  },

  "company_profile":   { "…": "P1" },
  "candidate_profile": { "…": "P2" },
  "jd_profile":        { "…": "P3" },
  "gap_report":        { "…": "P4" },
  "strategy":          { "…": "P5" },
  "blueprint":         { "…": "P6 — goals, banks, rubrics" },
  "coding_challenge":  { "…": "P7" },

  "runtime": {
    "current_section_id": "sec_03",
    "active_goal_id": "goal_k8s_depth",
    "elapsed_sec": 812,
    "turn": 14,
    "asked_bank_ids": ["qb_07", "qb_12"],
    "turns_on_active_goal": 3,
    "consecutive_weak_answers": 1,
    "corrections_used": 0,
    "current_difficulty": 3,
    "recent_acknowledgements": ["Got it.", "That makes sense."],
    "recent_skill_tags": ["kubernetes", "kubernetes", "postgres"],
    "flags": []
  },

  "memory_ref":   "mem_ses_01H...",
  "coverage_ref": "cov_ses_01H..."
}
```

`runtime` exists so the §4 rule layer can be evaluated in pure code, with no model call and no lookups.

### 3.2 `blueprint` — emitted by P6

Goals, not a script. `question_bank` is an unordered pool; nothing in this object implies sequence.

```json
{
  "blueprint_version": 2,
  "estimated_duration_min": 15,
  "sections": [
    {
      "section_id": "sec_03",
      "type": "resume_skills",
      "title": "Verifying claimed skills",
      "time_budget_sec": 300,
      "time_ceiling_sec": 380,
      "entry_transitions": [
        "I'd like to pick up on a couple of things from your resume.",
        "Let's move to your own background for a bit."
      ],
      "exit_transitions": [
        "That's helpful. Let's shift to what the role itself needs.",
        "Okay — I want to move to the job side of things."
      ],
      "goals": [
        {
          "goal_id": "goal_k8s_depth",
          "priority": 0.95,
          "skill_tags": ["kubernetes"],
          "statement": "Establish whether the Kubernetes claim is hands-on implementation or observational exposure.",

          "evidence_required": [
            { "evidence_id": "ev_k8s_workload", "description": "Names the specific workload deployed", "tier": "must_have", "weight": 3 },
            { "evidence_id": "ev_k8s_ownership", "description": "States who authored the manifests or charts", "tier": "must_have", "weight": 3 },
            { "evidence_id": "ev_k8s_incident", "description": "Describes a concrete problem hit and how it was diagnosed", "tier": "good_to_have", "weight": 2 },
            { "evidence_id": "ev_k8s_tradeoff", "description": "Reflects on whether Kubernetes was the right choice", "tier": "bonus", "weight": 1 }
          ],

          "completion_criteria": {
            "required_evidence": ["ev_k8s_workload", "ev_k8s_ownership"],
            "min_confidence": 0.7,
            "min_depth": "implementation"
          },

          "exit_conditions": [
            { "type": "evidence_complete" },
            { "type": "diminishing_returns", "no_new_evidence_for_turns": 2 },
            { "type": "candidate_disclaims", "detail": "Candidate states clearly they have not used it hands-on" },
            { "type": "time_ceiling", "max_turns": 5 },
            { "type": "distress", "detail": "Two consecutive answers show the candidate is out of depth" }
          ],

          "question_bank": [
            {
              "bank_id": "qb_07",
              "text": "You listed Kubernetes on your resume — what did you actually deploy with it?",
              "targets_evidence": ["ev_k8s_workload", "ev_k8s_ownership"],
              "difficulty": 2,
              "grading_mode": "experiential",
              "entry_style": "direct",
              "rubric": { "…": "see §3.4" }
            },
            {
              "bank_id": "qb_08",
              "text": "Walk me through what happened the last time a deploy of yours didn't go cleanly.",
              "targets_evidence": ["ev_k8s_incident", "ev_k8s_ownership"],
              "difficulty": 3,
              "grading_mode": "experiential",
              "entry_style": "story",
              "rubric": { "…": "…" }
            }
          ],

          "followup_bank": [
            { "followup_id": "fu_21", "for_evidence": "ev_k8s_ownership",
              "text": "Did you write the manifests yourself, or were they already there when you joined?",
              "use_when": "ownership_ambiguous" },
            { "followup_id": "fu_22", "for_evidence": "ev_k8s_incident",
              "text": "How did you work out that was the cause?",
              "use_when": "problem_named_without_diagnosis" }
          ]
        }
      ]
    }
  ]
}
```

Three properties matter here:

- **`targets_evidence` is the join key.** L3 knows what a question is for; L1 selects by gap, not by index.
- **`exit_conditions` are typed**, so L3 can evaluate most of them deterministically.
- **`entry_style`** lets L1 avoid two identically-shaped openings in a row without needing to reason about phrasing.

### 3.3 `evidence_coverage` — owned by L3

```json
{
  "coverage_id": "cov_ses_01H...",
  "session_id": "ses_01H...",
  "updated_at_turn": 14,

  "goals": [
    {
      "goal_id": "goal_k8s_depth",
      "status": "in_progress | satisfied | abandoned | not_started",
      "turns_spent": 3,
      "confidence": 0.55,
      "depth_reached": "surface | working | implementation | design",

      "evidence": [
        { "evidence_id": "ev_k8s_workload", "status": "verified", "confidence": 0.9,
          "source_question_ids": ["q_07"], "span": "deployed our FastAPI service", "verified_at_turn": 12 },
        { "evidence_id": "ev_k8s_ownership", "status": "partial", "confidence": 0.4,
          "source_question_ids": ["q_07"], "span": "the cluster was already there", "note": "Authorship still unclear" },
        { "evidence_id": "ev_k8s_incident", "status": "missing", "confidence": 0.0 },
        { "evidence_id": "ev_k8s_tradeoff", "status": "missing", "confidence": 0.0 }
      ],

      "outstanding": ["ev_k8s_ownership", "ev_k8s_incident"],
      "completion_check": { "satisfied": false, "blocking": ["ev_k8s_ownership"] },
      "exit_check": { "triggered": false, "closest": "diminishing_returns (1/2)" }
    }
  ],

  "by_skill": [
    { "skill": "kubernetes", "verified_concepts": 1, "total_concepts": 4,
      "confidence": 0.55, "depth": "working", "jd_importance": 0.8, "still_needed": 2 }
  ],

  "section_status": [
    { "section_id": "sec_03", "goals_total": 2, "goals_satisfied": 0,
      "complete": false, "time_used_sec": 190, "time_budget_sec": 300 }
  ]
}
```

### 3.4 `question_record` — the evaluation atom

Created when a question is asked (from a bank entry or a follow-up), completed by E1–E5.

```json
{
  "question_id": "q_07",
  "section_id": "sec_03",
  "goal_id": "goal_k8s_depth",
  "bank_id": "qb_07",
  "parent_question_id": null,
  "origin": "bank | followup | callback | closing | correction",
  "sequence": 7,
  "turn": 12,

  "text": "You listed Kubernetes on your resume — what did you actually deploy with it?",
  "as_spoken": "Okay, that makes sense. I'd like to pick up on something — you listed Kubernetes on your resume. What did you actually deploy with it?",
  "intent_snapshot": { "…": "the L1 intent that produced this question, §3.6" },
  "utterance_plan": { "…": "the L4 plan that worded it, §3.7" },

  "targets_evidence": ["ev_k8s_workload", "ev_k8s_ownership"],
  "skill_tags": ["kubernetes"],
  "difficulty": 2,
  "grading_mode": "factual | experiential | behavioral | coding",
  "weight": 1.0,

  "rubric": {
    "expected_signals": [
      { "id": "s1", "evidence_id": "ev_k8s_workload", "signal": "Names the actual workload deployed",
        "tier": "must_have", "weight": 3,
        "accept_if_candidate_says": ["deployed", "our service", "the API", "pods for"] },
      { "id": "s2", "evidence_id": "ev_k8s_ownership", "signal": "States who authored the manifests",
        "tier": "must_have", "weight": 3,
        "accept_if_candidate_says": ["I wrote", "I set up", "helm chart", "yaml"] }
    ],
    "common_misconceptions": [],
    "volatility": "stable",
    "max_followups": 3
  },

  "asked_at": "2026-08-07T09:14:22Z",
  "answer": {
    "start_ms": 854200, "end_ms": 921450, "duration_ms": 67250,
    "transcript": "So, umm, I deployed our FastAPI service on a cluster…",
    "word_count": 142,
    "words": [ { "w": "So", "s": 854200, "e": 854310, "conf": 0.98 } ],
    "asr_confidence_avg": 0.94,
    "interrupted": false,
    "silence_before_answer_ms": 2200
  },

  "speech_metrics": { "…": "E2" },
  "evidence":       { "…": "E3" },
  "observations":   { "…": "E4" },
  "scores":         { "accuracy": 6.5, "fluency": 7.2, "depth": 5.0 },
  "rewrite":        { "…": "E5" },
  "status": "asked | answered | skipped | graded | ungraded"
}
```

`as_spoken`, `intent_snapshot`, and `utterance_plan` exist so that any turn can be replayed and debugged end to end: what was known, what was decided, how it was worded, what was actually said.

### 3.5 `interview_memory` — owned by L2

```json
{
  "memory_id": "mem_ses_01H...",
  "session_id": "ses_01H...",
  "updated_at_turn": 14,

  "items": [
    {
      "item_id": "mem_04",
      "kind": "project",
      "label": "AI chatbot with LangChain + Pinecone",
      "detail": "Retrieval chatbot built solo; embeddings in Pinecone.",
      "technologies": ["LangChain", "Pinecone"],
      "related_skills": ["ai", "vector_search", "python"],
      "confidence": 0.8,
      "importance": 0.85,
      "depth_signal": "surface_mention",
      "source_question_id": "q_03",
      "turn": 4,
      "verified": false,
      "callback_candidates": [
        { "text": "how did you decide what to embed?", "best_for_goal": "goal_ai_depth", "value": 0.9 },
        { "text": "how did retrieval quality hold up?", "best_for_goal": "goal_ai_depth", "value": 0.75 }
      ],
      "used_in_questions": []
    },
    {
      "item_id": "mem_09",
      "kind": "unverified_claim",
      "label": "Cut processing time by 40%",
      "detail": "Stated during resume walkthrough; no baseline or method given.",
      "related_skills": ["python", "performance"],
      "confidence": 0.5,
      "importance": 0.9,
      "source_question_id": "q_05",
      "turn": 7,
      "verified": false,
      "callback_candidates": [
        { "text": "what was the baseline before that 40%?", "best_for_goal": "goal_claims", "value": 0.95 }
      ]
    },
    {
      "item_id": "mem_11",
      "kind": "weakness",
      "label": "Ownership of infra work unclear",
      "detail": "Described cluster as pre-existing; deflected authorship twice.",
      "related_skills": ["kubernetes"],
      "confidence": 0.6,
      "importance": 0.7,
      "source_question_id": "q_07",
      "turn": 12
    }
  ],

  "kinds": [
    "project", "technology", "claim", "metric", "achievement", "weakness",
    "strong_answer", "unverified_claim", "story", "leadership_example",
    "behavioral_example", "architecture_discussion", "coding_hint", "company_specific"
  ],

  "contradictions": [
    { "item_ids": ["mem_04", "mem_16"], "detail": "Team size given as 'solo' then 'four of us'",
      "severity": "minor", "surface_in_report": true, "probe": false }
  ],

  "open_callbacks": ["mem_04", "mem_09"],
  "spent_callbacks": ["mem_02"]
}
```

`open_callbacks` is a priority queue. L1 reads the top few; L4 never sees the whole store.

### 3.6 `conversational_intent` — emitted by L1

```json
{
  "action": "PROBE_EVIDENCE | NEW_GOAL_QUESTION | CALLBACK | REASSURE_AND_RETRY | CORRECT_AND_CONTINUE | CLOSE_GOAL | TRANSITION_SECTION | CLOSE_INTERVIEW",
  "target_goal": "goal_k8s_depth",
  "target_skill": "kubernetes",
  "missing_evidence": ["ev_k8s_ownership"],
  "source": { "type": "followup_bank", "id": "fu_21" },
  "transition_type": "none | soft_pivot | hard_pivot | section_change | callback_bridge",
  "emotional_tone": "neutral | encouraging | warm | brisk | steady",
  "callback_memory": null,
  "response_strategy": "direct | scaffold | narrow | broaden | concrete_example | rephrase",
  "difficulty_delta": 0,
  "acknowledge_answer": true,
  "reason": "Workload named; authorship still ambiguous after one probe.",
  "confidence": 0.82
}
```

### 3.7 `utterance_plan` — emitted by L4

```json
{
  "acknowledgement": "Okay, that makes sense.",
  "transition": "Let me stay on that for a second —",
  "utterance": "did you write those manifests yourself, or were they already in place when you joined?",
  "prosody": {
    "rate": 0.97,
    "emotion": "warm",
    "pauses_ms": [ { "after_segment": "acknowledgement", "ms": 320 } ],
    "emphasis": ["yourself"]
  },
  "expected_duration_sec": 6.5,
  "allow_barge_in_after_ms": 800,
  "audio": { "source": "cache | live_tts", "asset_id": "va_qb07_encouraging", "url": "s3://…/va_qb07_encouraging.wav" }
}
```

**Contract:** the Blueprint never emits emotion tags. The Conversation Manager never emits sentences. The Dialogue Styler never chooses topics. The Voice Interviewer never chooses anything.

---

## 4. Natural conversation rules

These are the rules a good interviewer follows without thinking about them. They are **deterministic code**, not prompt instructions, for three reasons: they are constraints rather than judgements, they must hold on turn 25 exactly as firmly as on turn 3, and every one of them is cheaper to check than to reason about.

They run twice per turn: as a **pre-filter** that removes illegal actions from L1's candidate set before the model is called, and as a **post-validator** that rejects an illegal intent and resamples.

### R1 · No two similar questions consecutively

```python
def violates_similarity(candidate, runtime, last_q):
    if candidate.skill_tags == last_q.skill_tags and candidate.entry_style == last_q.entry_style:
        return True
    if embedding_similarity(candidate.text, last_q.text) > 0.82:
        return True
    return False
```

Note this bars *similar-shaped* questions, not staying on a topic. Probing the same skill from a different angle is exactly what a good interviewer does; asking the same question twice in different words is what a bad one does.

### R2 · No abrupt topic switches

A `hard_pivot` — changing skill *and* section *and* framing in one turn — is only legal when the previous goal closed (`satisfied` or `abandoned`). Otherwise the intent must carry `transition_type: soft_pivot` and L4 must emit a bridging clause. Rule: **every topic change is announced before it happens.**

### R3 · Reference previous answers naturally

If `open_callbacks` contains an item with `value ≥ 0.8` whose `best_for_goal` is the active goal, `CALLBACK` is boosted in the candidate set. A callback must name the thing: L4 rejects any callback utterance that does not contain a concrete noun from the memory item's `label` or `technologies`.

Ceiling: at most one callback per three turns, and never two consecutively — over-callbacking reads as a parlour trick rather than attention.

### R4 · Escalate difficulty gradually

```python
difficulty_delta ∈ {-1, 0, +1}                     # never jump two levels
+1 requires: last answer covered all must_have evidence AND confidence ≥ 0.75
-1 requires: consecutive_weak_answers >= 2
hard floor: strategy.difficulty_curve.start_level - 1
hard ceiling: strategy.difficulty_curve.max_level
after a -1: no +1 for at least 2 turns                    # no yo-yo
```

### R5 · Acknowledge naturally, never over-praise

`acknowledge_answer: true` is the default. But:

- Acknowledgements are **neutral**, never evaluative. Permitted: *"Got it." "Okay." "That makes sense." "Right." "Mm-hm."* Forbidden: *"Great answer." "Perfect." "Exactly right." "Hmm, not quite."*
- **Why this matters beyond tone:** evaluative feedback mid-interview changes how the candidate performs for the remaining turns, which corrupts the evidence the evaluation phase is built on. This is a data-integrity rule wearing a politeness costume.

### R6 · Never reuse an acknowledgement phrase within 4 turns

```python
banned = runtime.recent_acknowledgements[-4:]
plan.acknowledgement not in banned   # L4 resamples on violation
```

Repetition is the single most common tell that a voice agent is not a person. It costs one array lookup to eliminate.

### R7 · Never over-correct

- `CORRECT_AND_CONTINUE` requires a `major`-severity factual error — something that would mislead the candidate if left standing.
- Maximum **two per interview**, tracked in `runtime.corrections_used`.
- Never inside the first two turns of a section (the candidate is still settling).
- Never immediately after a weak answer — correcting someone who is already struggling compounds the damage and gains nothing.
- The correction is one sentence, unevaluative, and immediately followed by moving on.

### R8 · Maintain conversational rhythm

- No more than **4 consecutive turns on one goal** without either new evidence or a `transition_type` change.
- Long question after long answer is discouraged: if the last answer exceeded 90 seconds, `response_strategy: narrow` is boosted and L4 caps the utterance at 25 words.
- Section entry and exit always use a transition from the blueprint's `entry_transitions` / `exit_transitions`, never a bare question.
- Never two `story`-style questions consecutively; alternate `direct` and `story` entry styles.

### R9 · Recover gracefully after weak answers

```python
if consecutive_weak_answers >= 1:
    boost(REASSURE_AND_RETRY, response_strategy ∈ {scaffold, narrow, concrete_example})
    emotional_tone := "encouraging"
if consecutive_weak_answers >= 2:
    force CLOSE_GOAL or TRANSITION_SECTION       # stop digging
    difficulty_delta := -1
if candidate said "I don't know" twice on one goal:
    CLOSE_GOAL is mandatory                      # never press a third time
```

A candidate who has failed twice on a topic yields no further signal — continuing is both unkind and uninformative. This rule protects the data as much as the person.

### R10 · Transition between sections naturally

A `TRANSITION_SECTION` intent must carry:
1. a closing acknowledgement of the section just ended,
2. an `exit_transition` from the outgoing section, and
3. an `entry_transition` into the incoming one.

L4 renders all three as one utterance. A section change that arrives as a bare question is rejected by the post-validator.

### R11 · Never ask what memory already answers

If an evidence item is already `verified` with `confidence ≥ 0.8`, questions targeting it are removed from the candidate set. Asking someone something they already told you is the fastest way to signal you were not listening.

### Rule evaluation order

```python
def legal_actions(session, coverage, memory, blueprint):
    candidates = enumerate_actions(blueprint, coverage, memory)   # all structurally possible
    candidates = [c for c in candidates if not violates_similarity(c, ...)]   # R1
    candidates = [c for c in candidates if pivot_allowed(c, ...)]             # R2
    candidates = drop_verified_targets(candidates, coverage)                  # R11
    candidates = apply_difficulty_bounds(candidates, session.runtime)         # R4
    candidates = apply_recovery_policy(candidates, session.runtime)           # R9
    candidates = apply_correction_budget(candidates, session.runtime)         # R7
    candidates = apply_rhythm_policy(candidates, session.runtime)             # R8
    candidates = boost_callbacks(candidates, memory)                          # R3
    return candidates[:8]      # L1 chooses among at most 8 — small prompt, fast call
```

Capping the candidate set at eight is a latency decision as much as a quality one: L1's prompt stays small and near-constant in size regardless of how far into the interview it is.

---

## 5. O1 · Interview Orchestrator

| Field | Value |
|---|---|
| **Type** | Service — deterministic finite state machine |
| **Runs** | Entire session lifecycle |
| **LLM** | **None** |
| **Tools** | Job queue (Temporal / Inngest / BullMQ), Postgres, Redis, WebSocket to client |
| **Latency budget** | <20 ms per transition, <40 ms for full turn ingest |

### Why the Orchestrator must not reason

This is the most consequential structural decision in the document, and adding L1, L2, L3 and L4 makes it more important rather than less. Six arguments, each independently sufficient.

**1 · Routing is not intelligence.** Every decision the Orchestrator makes is a comparison against a number or a lookup in a table: which state are we in, has the time ceiling been crossed, did L1 return within its timeout, which component runs next, what happens when P1 fails. There is no ambiguity in any of these for a model to resolve. Putting a model there does not add capability; it adds variance to something that was already correct.

**2 · A reasoning orchestrator has no termination guarantee.** An LLM deciding "is this interview over?" will sometimes decide no, forever. A state machine with a wall-clock ceiling always terminates. For a product where a runaway session bills real audio tokens per second, this is a cost-control property, not just a correctness one.

**3 · Latency.** The Orchestrator runs many times per turn — on answer ingest, after L3, before L1, after L1, before L4, before L5. At 20 ms each, that is invisible. At 300 ms each, the turn budget is gone before the interviewer has decided anything. **The reasoning budget in the live loop is finite, and it should all be spent in L1 and L4, where reasoning is actually required.**

**4 · Reproducibility.** Replaying a session must produce the same routing. If the same transcript sometimes advances to `sec_04` and sometimes to `sec_05`, no evaluation is comparable to any other, no regression test is meaningful, and no score is defensible to a student who asks why they got a 6.

**5 · Debugging.** When an interview goes wrong you need to answer: was it the decision, the wording, the coverage state, or the routing? If routing is deterministic, you can eliminate it in one glance at the state log. If routing is inferred, every bug investigation starts with "and possibly the orchestrator did something odd", which is not an investigation, it is a shrug.

**6 · Failure isolation.** Deterministic routing lets every component fail independently with a defined fallback (see below). If L1 times out, the Orchestrator picks the highest-priority unmet evidence item and proceeds — the interview continues, slightly less adaptively, and the candidate notices nothing. An LLM orchestrator asked to handle a subordinate's timeout will improvise, and improvised failure handling is how one slow call becomes a broken session.

**The division of labour in one line:** the Orchestrator decides *when* things happen; L1 decides *what* happens; L4 decides *how it sounds*.

### State machine

```
INTAKE ──▶ PREPARING ──▶ READY ──▶ LIVE ──▶ EVALUATING ──▶ COMPLETE
   │            │                    │            │
   └────────────┴─────── FAILED ◀────┴────────────┘
```

### Turn cycle — showing that the Orchestrator makes no interview decisions

```python
def on_answer_complete(session, question, answer):
    # ── 1. INGEST (deterministic bookkeeping only) ────────────────────────
    persist_answer(question.question_id, answer)
    session.runtime.turn += 1
    session.runtime.elapsed_sec = wall_clock() - session.started_at

    # ── 2. UPDATE WORLD MODEL (fast path, blocking, no model call) ───────
    coverage = evidence_tracker.ingest(          # L3 · <40ms · lexical+embedding
        question=question, answer=answer, rubric=question.rubric
    )
    interview_memory.ingest_async(               # L2 · fire-and-forget
        question=question, answer=answer, session_id=session.id
    )

    # ── 3. HARD CEILINGS (safety rails, not interviewing) ────────────────
    #    These do not decide what to ask. They decide what is still ALLOWED.
    if session.runtime.elapsed_sec >= session.strategy.total_ceiling_sec:
        return force_close_interview(session)

    section = current_section(session)
    if section.time_used_sec >= section.time_ceiling_sec:
        return force_advance_section(session)    # ceiling, not the normal path

    # ── 4. NORMAL SECTION COMPLETION IS EVIDENCE-DRIVEN, NOT COUNT-DRIVEN ─
    if coverage.section_complete(section.section_id):
        return advance_section(session, reason="evidence_complete")

    # ── 5. RULE LAYER (deterministic, §4) ────────────────────────────────
    candidates = legal_actions(session, coverage, interview_memory.snapshot(), session.blueprint)
    if not candidates:                            # every goal closed, time remains
        return advance_section(session, reason="no_legal_actions")

    # ── 6. THE ONLY INTERVIEW DECISION — DELEGATED, NOT MADE ─────────────
    try:
        intent = conversation_manager.decide(     # L1 · ≤350ms · blocking
            candidates=candidates,
            coverage=coverage.for_prompt(section),
            memory=interview_memory.top_callbacks(3),
            runtime=session.runtime,
            last_answer=answer.transcript
        )
        intent = validate_intent(intent, candidates)   # §4 post-validation
    except (Timeout, ValidationError):
        intent = fallback_intent(candidates)      # highest-priority unmet evidence
        session.runtime.flags.append("l1_fallback")

    # ── 7. WORDING — ALSO DELEGATED ──────────────────────────────────────
    try:
        plan = dialogue_styler.render(            # L4 · ≤200ms · often pre-warmed
            intent=intent, runtime=session.runtime,
            persona=session.inputs.interviewer_persona,
            section=section
        )
        plan = validate_plan(plan, session.runtime)    # R6, R3-naming, R10
    except (Timeout, ValidationError):
        plan = neutral_plan(intent)               # bank text + neutral acknowledgement

    # ── 8. APPLY STATE CHANGES THE INTENT IMPLIES (mechanical) ───────────
    apply_intent_bookkeeping(session, intent, plan)
    #   · append plan.acknowledgement to recent_acknowledgements
    #   · append intent.target_skill to recent_skill_tags
    #   · current_difficulty += intent.difficulty_delta  (clamped by R4)
    #   · mark callback memory item as spent
    #   · reset or increment consecutive_weak_answers, turns_on_active_goal
    #   · if action == CLOSE_GOAL: coverage.close(intent.target_goal)

    # ── 9. SPEAK ─────────────────────────────────────────────────────────
    return voice.speak(plan)                      # L5
```

Read step 6 and step 7 carefully: the Orchestrator constructs inputs, enforces timeouts, validates outputs, and applies consequences. It does not choose a goal, a question, a tone, or a word.

### Failure policy

| Component fails | Orchestrator does |
|---|---|
| P1 Company Research | Continue with `company_profile = null`; P6 drops company-specific goals |
| P2 Resume Parser | Hard fail — retry once, then surface an error. There is no interview without it |
| P4 / P5 | Fall back to a default strategy template for the seniority level |
| P6 Blueprint | Hard fail. Retry once with reduced section count |
| **L1 Conversation Manager (timeout)** | `fallback_intent()`: highest-priority unmet evidence in the active goal, `transition_type: none`, `tone: neutral`, bank question. Never make the candidate wait |
| **L2 Interview Memory (fail/slow)** | Proceed without it. Callbacks are disabled for that turn; nothing else changes |
| **L3 Evidence Tracker (fail)** | Fall back to question-count and time budgets for section completion, and log the degradation. This is the v1 behaviour — acceptable as a fallback, unacceptable as the design |
| **L4 Dialogue Styler (timeout)** | `neutral_plan()`: bank text verbatim, neutral acknowledgement, default prosody. The interview gets flatter, not broken |
| L5 Voice session drop | Reconnect with session resumption; replay last utterance plan if it had not completed |
| E3 Evidence | Grade against rubric with `evidence_confidence: "unverified"` |
| E4 Grading (one question) | Mark `ungraded`, exclude from denominators, continue |

**Every live-loop fallback degrades the interview's texture and never its termination.** That property is only available because the Orchestrator is deterministic.

---

## 6. Phase 1 · Preparation agents

---

### P1 · Company Research Agent

| Field | Value |
|---|---|
| **Type** | Tool-using Agent |
| **Runs** | Phase 1, parallel with P2/P3 |
| **LLM** | Flash/Sonnet-class |
| **Tools** | `web_fetch(url)`, `web_search(query)`, HTML→markdown extractor, 7-day cache keyed on domain |
| **Budget** | Max 6 tool calls, 40s timeout |

**System prompt**

```
You are a hiring researcher preparing an interviewer's briefing on a company.

You are given a company URL and optionally a company name. Use your tools to
build a factual profile that another agent will use to write interview goals.

RESEARCH ORDER (stop as soon as you have enough — do not exhaust your budget):
1. Fetch the homepage.
2. Fetch the careers/engineering/about page if linked.
3. Fetch the engineering blog index if one exists.
4. At most two web searches: "<company> tech stack" and "<company> engineering culture".

RULES
- Report only what you actually read. Never infer a tech stack from the industry.
- Mark every field with a confidence: "high" (stated on their own site),
  "medium" (secondary source), "low" (inferred).
- If the site is unreachable, empty, or parked, return status
  "insufficient_data" with whatever you did find. Do not invent.
- Marketing adjectives are not values. "We are passionate about innovation"
  is not a value; "code review before merge" is.
- interview_emphasis must be justifiable from evidence you collected. If you
  cannot justify it, return an empty list.

Return ONLY the JSON object in the output schema. No prose.
```

**Input**

```json
{ "session_id": "ses_01H...", "company_url": "https://stripe.com",
  "company_name_hint": null, "jd_title_hint": "Backend Engineer, Payments" }
```

**Output → P4, P6, P7**

```json
{
  "status": "ok | insufficient_data",
  "company": { "name": "Stripe", "domain": "stripe.com", "industry": "Payments infrastructure",
               "size_hint": "large", "one_liner": "APIs for online payments and financial infrastructure." },
  "products": [ { "name": "Payments API", "description": "…", "confidence": "high" } ],
  "tech_stack": [ { "tech": "Ruby", "area": "backend", "confidence": "high", "source": "engineering blog" } ],
  "engineering_culture": [ { "signal": "Heavy emphasis on API design reviews", "confidence": "high", "source": "https://…" } ],
  "values": ["Users first", "Rigor", "Ownership"],
  "recent_news": [ { "headline": "Launched AI-assisted fraud detection", "date": "2026-04", "relevance": "May appear in ML-adjacent goals" } ],
  "interview_emphasis": [ { "area": "Idempotency & distributed correctness", "why": "Core to payments domain", "weight": 0.8 } ],
  "sources": ["https://stripe.com", "https://stripe.com/blog/engineering"]
}
```

> **Cache aggressively.** Company profiles change monthly, not hourly. A Redis cache on `domain` with a 7-day TTL serves most traffic — many students interview at the same fifty companies — and reduces your largest prep cost to near zero.

---

### P2 · Resume Parser Agent

| Field | Value |
|---|---|
| **Type** | Agent (structured extraction) |
| **Runs** | Phase 1, parallel |
| **LLM** | Sonnet-class |
| **Tools** | PDF/DOCX text extraction before the model (`pdfplumber`, `mammoth`); vision fallback for design-heavy resumes |
| **Budget** | 1 call, 20s |

**System prompt**

```
You extract structured data from a candidate's resume for an interview
planning system.

Your most important job is not listing skills — it is identifying CLAIMS
WORTH PROBING. A claim is probe-worthy when it is:
  - specific enough to verify ("built a RAG pipeline with pgvector")
  - vague in a suspicious way ("expert in microservices", no project)
  - a strong assertion with weak evidence (a skill listed but never used
    in any described project or role)
  - impressive if true ("reduced p99 latency by 60%") — always probe numbers

For each skill, infer claimed_level from HOW it appears, not from a
self-rating. Use: expert | proficient | familiar | listed_only.
"listed_only" means it appears in a skills section and nowhere else — these
are the highest-value probe targets.

Never invent skills, dates, employers, or metrics. Record ambiguous dates as
given. If the document is not a resume, return status "not_a_resume".

Return ONLY JSON matching the output schema.
```

**Input**

```json
{ "session_id": "ses_01H...", "resume_text": "…", "resume_pages": 2,
  "extraction_method": "pdfplumber | vision" }
```

**Output → P4, P6, L2 (seeds memory), E4**

```json
{
  "status": "ok | not_a_resume | unreadable",
  "candidate": { "name": "R. Teja", "headline": "AI Engineer Intern",
                 "total_experience_months": 14, "seniority_estimate": "entry" },
  "skills": [
    { "skill": "Python", "category": "language", "claimed_level": "proficient",
      "evidence": ["Used in 3 listed projects"], "probe_priority": 0.4 },
    { "skill": "Kubernetes", "category": "infra", "claimed_level": "listed_only",
      "evidence": [], "probe_priority": 0.95 }
  ],
  "projects": [
    { "id": "prj_1", "name": "LASTMINUTE.AI", "role": "Solo developer", "description": "…",
      "technologies": ["Next.js", "LangChain"], "claimed_outcomes": ["Hackathon finalist"],
      "probe_hooks": ["How did you handle LLM latency?", "What was the retrieval strategy?"] }
  ],
  "experience": [
    { "id": "exp_1", "company": "Hathority LLC", "title": "AI Engineer Intern",
      "start": "2025-06", "end": "present", "highlights": ["…"],
      "quantified_claims": [ { "claim": "cut processing time by 40%", "probe_priority": 0.9 } ] }
  ],
  "education": [ { "degree": "B.Tech CSE", "institution": "…", "year": "2026" } ],
  "certifications": [],
  "probe_targets": [
    { "target": "Kubernetes", "reason": "Listed with zero supporting evidence", "priority": 0.95 },
    { "target": "40% processing-time claim", "reason": "Unverified quantified claim", "priority": 0.9 }
  ],
  "red_flags": [ { "type": "gap", "detail": "No activity Jan–Aug 2025", "probe": true } ]
}
```

> `projects`, `quantified_claims`, and `probe_targets` are written into L2 Interview Memory at session start as `kind: project` / `unverified_claim` items with `source: resume`. The interviewer therefore starts the conversation already "remembering" the resume — which is exactly what a human interviewer who read it beforehand does.

---

### P3 · JD Parser Agent

| Field | Value |
|---|---|
| **Type** | Agent (structured extraction) |
| **Runs** | Phase 1, parallel |
| **LLM** | Haiku/Flash-class |
| **Tools** | None |
| **Budget** | 1 call, 15s |

**System prompt**

```
You convert a job description into a structured hiring specification.

Separate REQUIRED from PREFERRED even when the JD blurs them. Signals for
required: "must have", "you have", attached years of experience, listed
first. Signals for preferred: "nice to have", "bonus", "familiarity with".

Also extract IMPLICIT expectations the JD never states but clearly demands.
A JD mentioning "on-call rotation" implies debugging and incident-response
goals even if it never says so. Mark these as implicit with your reasoning.

Infer seniority from scope language, not the title — titles are inconsistent
across companies. Use: intern | entry | mid | senior | staff+.

Never add technologies that are not in the text. Return ONLY JSON.
```

**Output → P4, P5, P6, P7**

```json
{
  "role": { "title": "Backend Engineer, Payments", "seniority": "mid",
            "years_experience_min": 3, "employment_type": "full_time" },
  "required_skills": [ { "skill": "Python", "importance": 1.0, "context": "primary language" } ],
  "preferred_skills": [ { "skill": "Kafka", "importance": 0.5, "context": "event pipelines" } ],
  "implicit_expectations": [ { "expectation": "Incident debugging under pressure",
                               "derived_from": "on-call rotation mention", "importance": 0.7 } ],
  "responsibilities": ["Design and ship payment APIs"],
  "soft_skills": ["Written communication", "Cross-team collaboration"],
  "domain_knowledge": ["Payments", "Idempotency", "Reconciliation"],
  "interview_focus_hint": ["system_design", "backend_depth", "behavioral"]
}
```

---

### P4 · Gap Analysis Agent

| Field | Value |
|---|---|
| **Type** | Agent (reasoning / join) |
| **Runs** | Phase 1, after P1+P2+P3 |
| **LLM** | Sonnet-class |
| **Budget** | 1 call, 20s |

Without this stage the interview investigates whatever is loudest on the resume. With it, the interview investigates what decides the outcome. It converts three documents into a ranked list — and that ranking becomes goal priority in P6 and gap weighting in L3.

**System prompt**

```
You compare a candidate's profile against a job's requirements and a
company's engineering emphasis, and produce a ranked investigation plan.

For every skill appearing in the JD requirements, the company emphasis, or
the resume, assign exactly one status:

  STRONG      — claimed with concrete supporting evidence
  WEAK        — claimed but thinly evidenced
  UNVERIFIED  — listed with no supporting evidence anywhere
  MISSING     — required by the JD, absent from the resume
  SURPLUS     — candidate has it, the job does not need it (do not probe)

Rank investigation priority. HIGH when:
  - the skill is required by the JD AND is UNVERIFIED or WEAK
  - a quantified claim is impressive and unverified
  - the company's emphasis overlaps a weak candidate area
LOW for STRONG skills (verification is cheap — one goal, shallow depth).
ZERO for SURPLUS.

For MISSING skills, do not plan a gotcha. Plan an investigation of whether
the candidate can reason toward it from adjacent knowledge. A good
interviewer probes learning ability, not ignorance.

Return ONLY JSON.
```

**Output → P5, P6**

```json
{
  "match_summary": { "overall_fit": 0.62, "required_coverage": 0.71, "confidence": "medium" },
  "skill_matrix": [
    { "skill": "Python", "status": "STRONG", "jd_importance": 1.0, "evidence": ["3 projects", "internship"],
      "investigation_priority": 0.3, "suggested_angle": "One depth probe on async/concurrency" },
    { "skill": "Kubernetes", "status": "UNVERIFIED", "jd_importance": 0.8, "evidence": [],
      "investigation_priority": 0.95, "suggested_angle": "Establish what was deployed and who wrote the manifests" },
    { "skill": "Kafka", "status": "MISSING", "jd_importance": 0.5, "evidence": [],
      "investigation_priority": 0.6, "suggested_angle": "Reasoning from adjacent queue experience, not recall" }
  ],
  "claims_to_verify": [
    { "claim": "Cut processing time by 40%", "source": "exp_1", "priority": 0.9,
      "verification_angle": "Baseline, method, and how it was measured" }
  ],
  "investigation_plan": [
    { "rank": 1, "focus": "Kubernetes depth", "reason": "Required + unverified", "min_evidence_items": 2 },
    { "rank": 2, "focus": "40% latency claim", "reason": "Unverified quantified claim", "min_evidence_items": 1 }
  ],
  "do_not_probe": ["Photoshop", "MS Office"]
}
```

---

### P5 · Interview Strategy Agent

| Field | Value |
|---|---|
| **Type** | Agent (planning) |
| **Runs** | Phase 1, after P4 |
| **LLM** | Sonnet-class |
| **Budget** | 1 call, 20s |

Decides **shape**: minutes per section, difficulty ramp, evidence depth targets, recovery policy, ceilings. It does not write goals or questions — that is P6. Keeping these apart is what stops the planner from designing a forty-minute interview for a fifteen-minute session.

**System prompt**

```
You are an interview strategist. Given a gap analysis, a JD, and a time
budget, decide the SHAPE of the interview. You do not write goals or
questions.

Hard constraints:
- Total must equal target_duration_min (±1 minute).
- Reserve 8% for greeting and 7% for closing.
- If coding_enabled is false, redistribute that time to technical depth.
- Budget ~75 seconds per exchange including the answer. Sections must be
  achievable in their allocation with 2–4 exchanges of headroom — a rushed
  interview yields worse evidence than a shorter one.

Allocation principles:
- Time follows investigation_priority, not resume order.
- Many UNVERIFIED required skills means more verification time, less
  behavioural time.
- Difficulty must RAMP: start at or below the candidate's demonstrated
  level and escalate only after a strong answer. Opening at maximum
  difficulty suppresses performance for the rest of the session and
  corrupts your signal.
- Define depth targets per priority skill: surface | working |
  implementation | design. This is what "enough evidence" means for that
  skill, and the Evidence Coverage Tracker enforces it.
- Define recovery policy: how the interview responds to consecutive weak
  answers.

Return ONLY JSON.
```

**Output → P6, P7, L1, L3**

```json
{
  "interview_style": "Conversational technical screen with depth probes",
  "total_ceiling_sec": 1050,
  "time_allocation": [
    { "section_type": "greeting",        "minutes": 1.5, "share": 0.10 },
    { "section_type": "candidate_intro", "minutes": 2.5, "share": 0.17 },
    { "section_type": "resume_skills",   "minutes": 5,   "share": 0.33 },
    { "section_type": "jd_skills",       "minutes": 4,   "share": 0.27 },
    { "section_type": "closing",         "minutes": 2,   "share": 0.13 }
  ],
  "priority_skills": [
    { "skill": "Kubernetes", "min_evidence_items": 2, "target_depth": "implementation" },
    { "skill": "PostgreSQL", "min_evidence_items": 2, "target_depth": "design" }
  ],
  "difficulty_curve": {
    "start_level": 2, "max_level": 4, "scale": "1-5",
    "escalate_when": "all must_have evidence covered with confidence >= 0.75",
    "de_escalate_when": "two consecutive answers miss must_have evidence"
  },
  "evidence_policy": { "min_confidence_to_close_goal": 0.7, "max_turns_per_goal": 5 },
  "recovery_policy": { "reassure_after_weak_answers": 1, "close_goal_after_weak_answers": 2 },
  "tone": { "formality": "warm_professional", "correction_policy": "major_errors_only", "max_corrections": 2 }
}
```

---

### P6 · Interview Blueprint Agent

| Field | Value |
|---|---|
| **Type** | Agent (generation) — **the most important agent in the system** |
| **Runs** | Phase 1, after P5 |
| **LLM** | Opus/Sonnet-class. Quality here sets the ceiling on the whole product |
| **Tools** | None |
| **Budget** | 1–2 calls (chunk by section if output is large), 60s |

**What changed and why it matters.** In v1 this agent emitted an ordered question list. It now emits a **goal graph**: for each goal, what evidence must be established, what "done" means, when to give up, and a *pool* of ways in. The interview's route is chosen live by L1; the destination is fixed here, before anyone speaks.

Two properties are preserved exactly from v1 and must not be traded away:

- **Rubrics are generated here, at plan time.** When the planner writes a bank question it already knows what a strong answer contains. Capturing that now makes post-interview grading a cheap comparison rather than a web search plus a reasoning chain per question, and makes scores reproducible across two runs of the same transcript.
- **`grading_mode` is assigned here**, and never later. A question about the candidate's own project cannot become factually gradable at evaluation time.

**System prompt**

```
You are a senior engineer designing a mock interview. You do NOT write a
script. You write GOALS, and for each goal you provide many possible ways in.
A separate live agent chooses which of them to use, in what order, based on
what the candidate actually says.

For each section, produce goals. Each goal has:

  statement          — one sentence: what must be established, and why
  evidence_required  — 3–5 specific, observable things a candidate would say
                       or demonstrate. Tier them: must_have (the goal is
                       unmet without it), good_to_have, bonus. Weight them.
  completion_criteria— which evidence ids must be verified, at what
                       confidence, at what depth
  exit_conditions    — typed conditions for abandoning this goal without
                       completing it. ALWAYS include diminishing_returns,
                       time_ceiling, and distress. A goal with no exit
                       condition is a trap for the candidate.
  question_bank      — 2–5 DIFFERENT ways to open this goal. Vary entry_style
                       between "direct" and "story". Each entry declares
                       which evidence ids it targets. These are NOT ordered.
  followup_bank      — targeted probes, each tied to one evidence id and a
                       use_when condition describing the answer shape that
                       should trigger it.

GRADING MODE — set on every bank entry:
  factual      — a verifiable technical concept exists independent of the candidate
  experiential — only the candidate knows (their own project or work)
  behavioral   — a situation or story question
Never mark a question factual unless a correct answer exists without the
candidate. This is not a formality: applying factual accuracy scoring to a
question about someone's own project produces feedback that tells a person
they were wrong about their own life.

RUBRICS — generate for every bank entry and every followup entry.
  factual      → expected_concepts, tiered and weighted, each with
                 accept_if_candidate_says: the phrasings a real candidate
                 might use. A grader string-matches these before reasoning,
                 and the live Evidence Tracker matches them in real time —
                 so make them generous and colloquial, not textbook.
  experiential → expected_signals: specificity, trade-off awareness,
                 personal ownership ("I" vs "we"), measurable outcome,
                 honesty about failure.
  behavioral   → STAR completeness plus a reflection signal.
Set volatility on factual entries:
  stable           — fundamentals; a grader must NOT search the web
  versioned        — tied to a library or framework version; search needed
  company_specific — about this company's products; search their docs

TRANSITIONS — for each section provide 2–3 entry_transitions and 2–3
exit_transitions as natural spoken sentences. The live styler picks among
them so no two interviews open a section identically. Do NOT include
emotion tags, stage directions, or pacing marks anywhere. Delivery is not
your job.

QUESTION QUALITY
- This is voice. Under 40 spoken words, one question per entry, no code in
  question text, no multi-part questions.
- Anchor resume goals to the resume: "You mentioned X on your resume…"
- No two bank entries for the same goal should target the identical
  evidence set — they are alternative routes, not paraphrases.
- Size the goal count to the section's time allocation. Fewer, better goals
  beat a bank that will never be used.

Return ONLY JSON.
```

**Input**

```json
{
  "session_id": "ses_01H...",
  "strategy":          { "…": "P5" },
  "gap_report":        { "…": "P4" },
  "candidate_profile": { "…": "P2" },
  "jd_profile":        { "…": "P3" },
  "company_profile":   { "…": "P1 or null" }
}
```

**Output → O1, L1, L3 (seeds coverage), L4 (transitions), E4 (rubrics)**

Full schema in §3.2. Abbreviated example of one section:

```json
{
  "blueprint_version": 2,
  "estimated_duration_min": 15,
  "total_goals": 7,
  "sections": [
    {
      "section_id": "sec_03",
      "type": "resume_skills",
      "title": "Verifying claimed skills",
      "time_budget_sec": 300,
      "time_ceiling_sec": 380,
      "entry_transitions": [
        "I'd like to pick up on a couple of things from your resume.",
        "Let's talk about your own background for a bit."
      ],
      "exit_transitions": [
        "That's helpful — let's shift to what the role itself needs.",
        "Okay, I want to move over to the job side of things."
      ],
      "goals": [
        {
          "goal_id": "goal_k8s_depth",
          "priority": 0.95,
          "skill_tags": ["kubernetes"],
          "statement": "Establish whether the Kubernetes claim is hands-on implementation or observational exposure.",
          "evidence_required": [
            { "evidence_id": "ev_k8s_workload",  "description": "Names the specific workload deployed",      "tier": "must_have",    "weight": 3 },
            { "evidence_id": "ev_k8s_ownership", "description": "States who authored the manifests or charts","tier": "must_have",    "weight": 3 },
            { "evidence_id": "ev_k8s_incident",  "description": "Concrete problem hit and how diagnosed",     "tier": "good_to_have", "weight": 2 },
            { "evidence_id": "ev_k8s_tradeoff",  "description": "Reflects on whether k8s was the right call", "tier": "bonus",        "weight": 1 }
          ],
          "completion_criteria": { "required_evidence": ["ev_k8s_workload", "ev_k8s_ownership"],
                                   "min_confidence": 0.7, "min_depth": "implementation" },
          "exit_conditions": [
            { "type": "evidence_complete" },
            { "type": "diminishing_returns", "no_new_evidence_for_turns": 2 },
            { "type": "candidate_disclaims" },
            { "type": "time_ceiling", "max_turns": 5 },
            { "type": "distress" }
          ],
          "question_bank": [
            { "bank_id": "qb_07", "text": "You listed Kubernetes on your resume — what did you actually deploy with it?",
              "targets_evidence": ["ev_k8s_workload", "ev_k8s_ownership"], "difficulty": 2,
              "grading_mode": "experiential", "entry_style": "direct", "rubric": { "…": "expected_signals" } },
            { "bank_id": "qb_08", "text": "Walk me through the last time one of your deploys didn't go cleanly.",
              "targets_evidence": ["ev_k8s_incident", "ev_k8s_ownership"], "difficulty": 3,
              "grading_mode": "experiential", "entry_style": "story", "rubric": { "…": "expected_signals" } }
          ],
          "followup_bank": [
            { "followup_id": "fu_21", "for_evidence": "ev_k8s_ownership", "use_when": "ownership_ambiguous",
              "text": "Did you write those manifests yourself, or were they already in place?" },
            { "followup_id": "fu_22", "for_evidence": "ev_k8s_incident", "use_when": "problem_named_without_diagnosis",
              "text": "How did you work out that was the cause?" }
          ]
        }
      ]
    }
  ]
}
```

---

### P7 · Coding Challenge Agent

| Field | Value |
|---|---|
| **Type** | Agent (selection + adaptation) |
| **Runs** | Phase 1, only if `coding_enabled` |
| **LLM** | Sonnet-class |
| **Tools** | Curated problem bank, code sandbox for reference-solution validation |
| **Budget** | 1 call, 30s |

> **Select, don't invent.** LLM-generated coding problems have a real defect rate: ambiguous specs, wrong reference solutions, tests that contradict the prompt. Keep a bank of 200–400 vetted problems tagged by topic, difficulty, and company style. Generate from scratch only when nothing matches, and always validate the reference solution against the hidden tests in a sandbox before it reaches a candidate.

**System prompt**

```
You select a coding or architecture problem for a live voice interview where
the candidate types in an editor while talking.

Selection criteria, in order:
1. Relevance to the JD's core work — a payments backend role gets
   idempotency and consistency problems, not tree traversal.
2. Company style, if known.
3. Difficulty from the strategy's difficulty_curve, adjusted DOWN one level.
   Candidates perform worse thinking aloud than coding silently.
4. Solvable in the allotted minutes INCLUDING explanation. Assume 40% of the
   time is spent talking.

The problem must be statable aloud in under 60 seconds. Long problem
statements fail in voice.

Provide: spoken statement, written statement for the editor pane, starter
code, 3 visible examples, 6+ hidden tests including edge cases, target
complexity, and 3 escalating hints the interviewer can offer if the
candidate stalls.

If the role is architecture-heavy and seniority is mid or above, you may
return an architecture problem with an evaluation rubric instead of tests.

Return ONLY JSON.
```

**Output → O1, L5, S1**

```json
{
  "challenge_type": "coding | architecture",
  "problem_id": "p_142", "source": "bank | generated",
  "title": "Idempotent payment retry",
  "spoken_statement": "Here's the problem. You're given a list of payment attempts, each with an idempotency key and an amount. Return the total charged, counting each key only once. Take a minute to think, and talk me through your approach before you code.",
  "editor_statement": "## Idempotent payment retry\n\nGiven `attempts: List[Tuple[str, int]]` …",
  "language_options": ["python", "javascript", "java"],
  "starter_code": { "python": "def total_charged(attempts):\n    pass\n" },
  "examples": [ { "input": "[('a',100),('a',100),('b',50)]", "output": "150" } ],
  "hidden_tests": [
    { "id": "t1", "input": "[]", "expected": "0", "tests": "empty input" },
    { "id": "t2", "input": "[('a',100),('a',200)]", "expected": "100", "tests": "first-write-wins on key collision" }
  ],
  "target_complexity": { "time": "O(n)", "space": "O(n)" },
  "hints": [
    { "level": 1, "text": "What data structure lets you check if you've seen a key before?" },
    { "level": 2, "text": "What should happen when the same key appears with a different amount?" },
    { "level": 3, "text": "Use a set of seen keys and skip any attempt whose key is already in it." }
  ],
  "evaluation_rubric": { "test_pass_weight": 0.5, "complexity_weight": 0.2,
                         "code_quality_weight": 0.15, "verbal_reasoning_weight": 0.15 }
}
```

---

### P8 · Voice Asset Pre-synthesis

| Field | Value |
|---|---|
| **Type** | Service — deterministic, no LLM |
| **Runs** | Phase 1, after P6 and P7; must complete before `READY` |
| **LLM** | None |
| **Tools** | TTS engine (batch mode), object storage, Redis asset index |
| **Budget** | 20–40 s for a full 15-minute interview's assets, parallelised |

**Why this component exists.** P6 emits the entire question bank before anyone speaks. That is a fact the live loop can exploit: an utterance that is already known can already be audio. Pre-synthesis converts the single largest live cost — TTS time-to-first-audio — into a cache lookup for most turns, and it is only possible because the blueprint is goal-driven with a fixed bank rather than improvised.

**What gets rendered**

| Asset class | Count (15-min interview) | Variants |
|---|---|---|
| Bank questions | ~14–20 | × 3 tones (`neutral`, `encouraging`, `brisk`) |
| Follow-up bank entries | ~20–30 | × 2 tones (`neutral`, `encouraging`) |
| Section entry/exit transitions | ~12 | × 1 |
| Acknowledgement pool | 24 | × 1 — shared across all sessions, rendered once globally |
| Coding problem spoken statement + hints | 4 | × 1 |
| Silence prompts and closing lines | 6 | × 1 shared |

Roughly 120–160 clips per session, of which the acknowledgement pool and generic prompts are global and rendered once for all users. Per-session synthesis is therefore ~100 clips of 5–8 seconds.

**Tone variants are prosody, not rewording.** The same text is rendered at three delivery settings; L4 still decides *which* tone applies and still writes any novel wording. What P8 removes is synthesis latency, not the Dialogue Styler's job.

**Cache hit policy**

```python
def resolve_audio(plan, intent):
    key = f"va_{intent.source.id}_{plan.prosody.emotion}"
    if asset_index.has(key) and plan.utterance == asset_index.text_of(key):
        return CachedAudio(key)                 # ~0 ms — most turns
    return LiveTTS(plan)                        # ~200 ms — follow-ups, callbacks, rephrasing
```

The equality check on `plan.utterance` matters: if L4 rephrased the bank text for spoken flow, the cached clip no longer matches what was decided, and the system must synthesize live rather than play something subtly different. **Never play a cached clip whose text does not exactly match the utterance plan.**

**Expected hit rate.** 60–70% in practice. `PROBE_EVIDENCE` and `NEW_GOAL_QUESTION` from the bank hit; `CALLBACK`, `REASSURE_AND_RETRY` with `rephrase`, and `CORRECT_AND_CONTINUE` always miss because their wording is generated per candidate.

**Output → L5, indexed in Redis for the session's lifetime**

```json
{
  "session_id": "ses_01H...",
  "voice_id": "interviewer_warm_professional_en_IN",
  "assets": [
    { "asset_id": "va_qb07_neutral", "source_type": "question_bank", "source_id": "qb_07",
      "tone": "neutral", "text": "You listed Kubernetes on your resume — what did you actually deploy with it?",
      "url": "s3://…/va_qb07_neutral.wav", "duration_sec": 5.4 },
    { "asset_id": "va_qb07_encouraging", "source_type": "question_bank", "source_id": "qb_07",
      "tone": "encouraging", "text": "You listed Kubernetes on your resume — what did you actually deploy with it?",
      "url": "s3://…/va_qb07_encouraging.wav", "duration_sec": 6.1 }
  ],
  "global_pools": { "acknowledgements": "pool_ack_v3", "silence_prompts": "pool_silence_v1" },
  "rendered": 104, "cached_globally": 30, "total_sec": 612, "status": "ready"
}
```

**Failure policy.** If P8 fails or is incomplete, the session still starts — L5 falls back to live TTS for every utterance. Turn latency rises by ~200 ms and the interview is still entirely functional. P8 is an optimisation, never a dependency.

---

## 7. Phase 2 · Live interview agents

> **The rule for this phase:** exactly two blocking model calls per turn — L1 and L4 — with hard timeouts and safe defaults. L3 is deterministic. L2 is asynchronous. L5 decides nothing.

---

### L1 · Conversation Manager

| Field | Value |
|---|---|
| **Type** | Agent (fast, blocking) — the interviewer's judgement |
| **Runs** | Phase 2, once per candidate answer |
| **LLM** | Haiku/Flash-class. **Latency matters more than raw capability here** |
| **Tools** | None |
| **Budget** | 1 call, **350 ms p95, hard timeout 550 ms → `fallback_intent()`** |
| **Output** | Structured intent only. Never a sentence. |

**What it replaces and why.** v1's Probe Decision Agent chose among four actions. That is a turn-taking policy. An interviewer's real per-turn decision is: which goal am I working, what evidence am I still missing, is this the moment to reach back to something said earlier, how is this person holding up, should I make this harder or easier, and how do I get from here to there. L1 answers all of those as separate fields, which is what makes each of them individually testable and tunable.

**Why the candidate set is pre-filtered.** L1 never enumerates possibilities. §4's rule layer hands it at most eight legal actions, already stripped of anything that would violate rhythm, repetition, difficulty, correction budget, or recovery policy. This does three things: it keeps the prompt small and near-constant in size regardless of turn number (the main cause of latency creep in live agents), it makes rule violations structurally impossible rather than merely discouraged, and it lets the model spend its whole budget on the judgement that actually needs a model.

**System prompt**

```
You are the judgement of an experienced technical interviewer. You decide
what happens next in the conversation. You do NOT write what will be said —
another component handles wording. Answer in under 200 tokens. Speed matters.

You are given: the goals still open, exactly what evidence is still missing
for each, what the candidate just said, what you already know about them,
and a list of LEGAL ACTIONS. You must choose one of the legal actions. Do
not invent an action outside the list.

HOW TO CHOOSE

Think in evidence, not in questions. The question is never the point; the
missing evidence is. Before choosing, ask yourself: what do I still not know
about this person that I need to know?

  PROBE_EVIDENCE       — the active goal has missing evidence and the last
                         answer opened a way toward it. The default action.
  NEW_GOAL_QUESTION    — this goal is done or stalled; start another one.
  CALLBACK             — something they mentioned earlier is the best route
                         into what you need now. Prefer this when available:
                         it is the single most human thing you can do.
  REASSURE_AND_RETRY   — they are struggling. Lower the bar, narrow the
                         question, give them a foothold. Do not just repeat.
  CORRECT_AND_CONTINUE — they stated something significantly wrong. Rare.
  CLOSE_GOAL           — enough evidence, or further probing yields nothing.
  TRANSITION_SECTION   — this section's goals are settled.
  CLOSE_INTERVIEW      — final section complete.

RESPONSE STRATEGY — how the next question should relate to the last answer:
  direct           — ask the thing plainly
  scaffold         — give them a starting point to build from
  narrow           — the answer was broad and unfocused; ask for one specific piece
  broaden          — the answer was narrow; open it up
  concrete_example — abstractions only; ask for a real instance
  rephrase         — they misread the question; ask it differently

EMOTIONAL TONE — read the candidate, not the transcript's content:
  neutral      — default, steady
  encouraging  — hesitation, self-correction, trailing off, long pauses
  warm         — they shared something genuine or admitted a failure honestly
  brisk        — they are confident and moving well; match their pace
  steady       — they are rambling; a calm, tighter frame helps them

DIFFICULTY: -1, 0, or +1. Never more. Raise only after an answer that
covered every must_have with specifics. Lower after two weak answers.

RULES YOU MUST NOT BREAK
- Never choose an action outside the legal list.
- Never emit question text, sentences, or wording of any kind.
- If the candidate said they don't know, do not probe the same evidence again.
- If the candidate has said they don't know twice on one goal, CLOSE_GOAL.
- Never CORRECT for a minor imprecision. Only for something that would
  mislead them if it went unchallenged.
- Prefer CALLBACK over a fresh question when a high-value callback is
  available and relevant to the evidence you need.

Return ONLY the JSON intent object.
```

**Input** — small, fixed-shape, never the full transcript

```json
{
  "turn": 14,
  "section": { "section_id": "sec_03", "type": "resume_skills",
               "time_used_sec": 190, "time_budget_sec": 300 },
  "active_goal": {
    "goal_id": "goal_k8s_depth",
    "statement": "Establish whether the Kubernetes claim is hands-on or observational.",
    "turns_spent": 3,
    "missing_evidence": [
      { "evidence_id": "ev_k8s_ownership", "description": "States who authored the manifests", "tier": "must_have", "status": "partial" },
      { "evidence_id": "ev_k8s_incident", "description": "Concrete problem hit and how diagnosed", "tier": "good_to_have", "status": "missing" }
    ],
    "closest_exit_condition": "diminishing_returns (1 of 2)"
  },
  "other_open_goals": [
    { "goal_id": "goal_pg_design", "priority": 0.8, "missing_count": 3, "section_id": "sec_03" }
  ],
  "last_answer": "So, umm, I deployed our FastAPI service on a cluster… the cluster was already there when I joined.",
  "last_answer_signals": { "word_count": 142, "hesitation": "moderate", "specificity": "low",
                           "said_dont_know": false, "answered_the_question": true },
  "candidate_state": { "consecutive_weak_answers": 1, "current_difficulty": 3, "recent_tone": "neutral" },
  "top_callbacks": [
    { "item_id": "mem_09", "kind": "unverified_claim", "label": "Cut processing time by 40%",
      "best_for_goal": "goal_claims", "value": 0.95 }
  ],
  "legal_actions": [
    { "action": "PROBE_EVIDENCE", "source": { "type": "followup_bank", "id": "fu_21" }, "targets": ["ev_k8s_ownership"] },
    { "action": "PROBE_EVIDENCE", "source": { "type": "question_bank", "id": "qb_08" }, "targets": ["ev_k8s_incident"] },
    { "action": "CLOSE_GOAL", "source": null, "targets": [] },
    { "action": "NEW_GOAL_QUESTION", "source": { "type": "question_bank", "id": "qb_15" }, "targets": ["ev_pg_indexing"] }
  ]
}
```

**Output** — `conversational_intent`, §3.6

```json
{
  "action": "PROBE_EVIDENCE",
  "target_goal": "goal_k8s_depth",
  "target_skill": "kubernetes",
  "missing_evidence": ["ev_k8s_ownership"],
  "source": { "type": "followup_bank", "id": "fu_21" },
  "transition_type": "none",
  "emotional_tone": "encouraging",
  "callback_memory": null,
  "response_strategy": "narrow",
  "difficulty_delta": 0,
  "acknowledge_answer": true,
  "reason": "Workload named; authorship deflected once. One narrow probe, then close regardless.",
  "confidence": 0.82
}
```

**Latency engineering**

- Input is a fixed shape and near-constant size. A growing context is what turns a 300 ms call into a 3-second one by turn twenty — L1 never receives the transcript, only the last answer and derived signals.
- Cap output at ~200 tokens. You need a decision, not an explanation.
- Speculatively pre-warm L4 on the two highest-prior candidate actions while the candidate is still speaking (see L4).
- On timeout, `fallback_intent()` picks the highest-priority unmet `must_have` evidence in the active goal with the matching bank entry, `tone: neutral`, `strategy: direct`. The interview stays coherent; it just stops being clever for one turn.

---

### L2 · Structured Interview Memory

| Field | Value |
|---|---|
| **Type** | Service (typed store) + Agent (async extraction) |
| **Runs** | Seeded at session start from P2; updated after every answer, asynchronously |
| **LLM** | Haiku/Flash-class |
| **Tools** | Redis (hot store) + Postgres (durable); embedding index for dedupe |
| **Budget** | 1 call per turn, **no latency requirement** — results are used from the next turn onward |

**What it replaces and why.** v1's Context Memory Agent stored topics and a suggested callback. That supports one behaviour. L2 stores a *typed working model of the candidate* across fourteen item kinds, which is what every downstream component actually needs: L1 needs open callbacks and unverified claims, L3 needs corroboration, E4 needs consistency history, E6 needs the strengths and gaps that the report is built from.

**Why it stays asynchronous.** Memory pays off from the following turn, not this one. Putting it on the critical path would roughly double turn latency to buy nothing. If the write lands after the next turn has begun, that turn simply runs without the newest item — which is exactly how human recall works anyway.

**Seeding.** At session start, P2's `projects`, `quantified_claims`, and `probe_targets` are written as memory items with `source: "resume"` and `verified: false`. The interviewer therefore begins already holding the resume in mind, and its first callbacks can reference it — the way a human interviewer who read your CV beforehand does.

**System prompt (extraction agent)**

```
You maintain an interviewer's working memory of a candidate. After each
answer you extract new memory items and update existing ones.

ITEM KINDS
project · technology · claim · metric · achievement · weakness ·
strong_answer · unverified_claim · story · leadership_example ·
behavioral_example · architecture_discussion · coding_hint · company_specific

EXTRACT an item only when it is:
  - raised by the candidate themselves, AND
  - not already present in existing_items (check by meaning, not wording), AND
  - substantial enough to build a real future question on

DO NOT extract: filler, restatements of the question, generic mentions
("I use Git"), or anything already known.

FOR EACH ITEM
  confidence   — how sure you are this is accurate as stated (0–1). A vague
                 or hedged claim gets low confidence, not omission.
  importance   — how much a future question on it would be worth (0–1)
  related_skills — which interview skill tags it touches
  callback_candidates — 1–2 natural follow-ups, each phrased as a reference
                 to what they said, not as a fresh question. A callback must
                 name the specific thing: "the Pinecone index", not "your
                 vector work".

SPECIAL HANDLING
  unverified_claim — any quantified or impressive assertion offered without
                     baseline, method, or measurement. These are the
                     highest-value items in the store. Always extract them.
  weakness         — a gap the candidate revealed. Record it neutrally and
                     factually. This feeds coaching, not judgement.
  strong_answer    — a genuinely strong moment. The report needs these; a
                     report with no strengths is useless to a student.

CONTRADICTIONS — if a new item conflicts with an existing one, record the
conflict rather than overwriting. Do not assume the newer statement is
correct. A contradiction may be a mistranscription, and quietly resolving it
would hide that.

Return an empty items array if nothing qualifies. That is normal and
frequent — most answers contain nothing new.
```

**Input**

```json
{
  "session_id": "ses_01H...",
  "turn": 14,
  "question_id": "q_07",
  "question_text": "You listed Kubernetes on your resume — what did you actually deploy with it?",
  "answer_transcript": "So, umm, I deployed our FastAPI service on a cluster… the cluster was already there.",
  "active_skills": ["kubernetes"],
  "existing_items": [ { "item_id": "mem_04", "kind": "project", "label": "AI chatbot with LangChain + Pinecone" } ]
}
```

**Output** — merged into `interview_memory`, §3.5

```json
{
  "new_items": [
    { "item_id": "mem_12", "kind": "project", "label": "FastAPI service on Kubernetes",
      "detail": "Deployed a FastAPI service to a pre-existing cluster.",
      "technologies": ["FastAPI", "Kubernetes"], "related_skills": ["kubernetes", "python"],
      "confidence": 0.85, "importance": 0.7, "depth_signal": "working",
      "source_question_id": "q_07", "turn": 14, "verified": false,
      "callback_candidates": [ { "text": "how the FastAPI service was rolled out without downtime",
                                 "best_for_goal": "goal_k8s_depth", "value": 0.8 } ] },
    { "item_id": "mem_13", "kind": "weakness", "label": "Infra ownership unclear",
      "detail": "Described the cluster as pre-existing; did not state authorship of manifests.",
      "related_skills": ["kubernetes"], "confidence": 0.6, "importance": 0.75,
      "source_question_id": "q_07", "turn": 14 }
  ],
  "updated_items": [],
  "contradictions": []
}
```

**Queries L2 exposes** (all O(1) against the hot store, no model call):

| Query | Consumer |
|---|---|
| `top_callbacks(n)` | L1, every turn |
| `open_unverified_claims()` | L1, L3 |
| `items_for_skill(skill)` | L1, E4 |
| `contradictions()` | E4, E6 |
| `strong_answers()` / `weaknesses()` | E6 |
| `snapshot()` | O1 rule layer |

---

### L3 · Evidence Coverage Tracker

| Field | Value |
|---|---|
| **Type** | Service — **deterministic, no LLM** |
| **Runs** | Seeded from P6 at session start; updated on every answer ingest, blocking |
| **LLM** | None on the fast path; optional async refinement (see below) |
| **Tools** | Redis; local embedding model for phrase matching |
| **Budget** | **<40 ms**, blocking. It runs before L1 every turn |

**What it replaces and why.** v1 tracked which questions had been asked and ended a section on a counter. That is bookkeeping. A real interviewer tracks *what they still don't know*. L3 makes that the primary control signal: sections end because the evidence is in, not because the list ran out.

**The two-speed design.** Fast path is deterministic and must stay that way, because it sits in front of L1 in the critical path:

```python
def ingest(question, answer, rubric):
    text = normalize(answer.transcript)
    for signal in rubric.expected_signals:            # from P6, at plan time
        # tier 1 — lexical: the accept_if_candidate_says phrases
        if any(phrase in text for phrase in signal.accept_if_candidate_says):
            mark(signal.evidence_id, "verified", confidence=0.85, span=locate(text, phrase))
            continue
        # tier 2 — embedding: paraphrase within threshold
        score = max(cos_sim(embed(sent), embed(signal.signal)) for sent in sentences(text))
        if score > 0.78:  mark(signal.evidence_id, "verified", confidence=score)
        elif score > 0.62: mark(signal.evidence_id, "partial",  confidence=score)
    recompute_goal_status()
    return snapshot()
```

An **async refinement pass** (Haiku-class, off the critical path) re-scores the same answer with reasoning and corrects the fast path's marks before the *next* turn. The fast path is optimistic and occasionally generous; the refinement pass is accurate. The evaluation phase reads the refined state, so no score is ever based on a lexical guess.

**Goal completion and exit** — both deterministic:

```python
def goal_satisfied(goal):
    req = goal.completion_criteria
    return (all(ev.status == "verified" for ev in required(goal, req.required_evidence))
            and mean_confidence(goal) >= req.min_confidence
            and depth_rank(goal.depth_reached) >= depth_rank(req.min_depth))

def exit_triggered(goal, runtime):
    for cond in goal.exit_conditions:
        if cond.type == "evidence_complete"     and goal_satisfied(goal):                     return cond
        if cond.type == "diminishing_returns"   and goal.turns_without_new_evidence >= cond.n: return cond
        if cond.type == "time_ceiling"          and goal.turns_spent >= cond.max_turns:        return cond
        if cond.type == "distress"              and runtime.consecutive_weak_answers >= 2:     return cond
        if cond.type == "candidate_disclaims"   and goal.dont_know_count >= 2:                 return cond
    return None

def section_complete(section_id):
    goals = goals_in(section_id)
    return all(g.status in ("satisfied", "abandoned") for g in goals) \
        or all(g.status == "satisfied" for g in must_have_goals(goals))
```

**Output** — `evidence_coverage`, §3.3. Consumed by O1 (section completion), L1 (gap list), E6 (skill verification in the report).

**`for_prompt(section)`** returns only the active goal's missing evidence plus a one-line summary of other open goals. L1 never receives the whole coverage object — that is how its prompt stays constant-size across a session.

---

### L4 · Dialogue Styler Agent

| Field | Value |
|---|---|
| **Type** | Agent (fast, blocking) |
| **Runs** | Phase 2, after L1, every turn |
| **LLM** | Haiku/Flash-class |
| **Tools** | None |
| **Budget** | 1 call, **200 ms p95, hard timeout 350 ms → `neutral_plan()`**. Frequently pre-warmed to ~0 ms |
| **Output** | An utterance plan. Never a topic decision. |

**Why this exists.** In v1 the agent that decided what to ask also wrote the sentence. Two costs followed. A model asked to reason about evidence coverage *and* produce warm natural phrasing does neither as well as two models doing one each. And the same question could only ever be delivered one way — so the interviewer sounded identical whether the candidate was cruising or drowning, which is the single clearest tell that there is no one there.

**L4 is the only source of TTS delivery instructions in the system.** P6 never emits emotion tags. L1 never emits sentences. If an emotion tag appears anywhere else in the pipeline, it is a bug.

**Same intent, different candidate state:**

| Candidate state | `emotional_tone` | Rendered |
|---|---|---|
| Struggling, hesitant | `encouraging` | *"No rush at all. Let's take it a piece at a time — just the deploy step: who set that up?"* |
| Confident, fluent | `brisk` | *"Nice. Then who wrote the manifests?"* |
| Rambling | `steady` | *"Okay. Let me narrow it — just the manifests. Yours, or already there?"* |
| Honest about a gap | `warm` | *"That's a fair answer, and it's a common setup. Who did write them, do you know?"* |

Identical intent. Identical evidence target. Four different interviews.

**System prompt**

```
You are the voice of an experienced interviewer. You are given a DECISION
that has already been made. Your only job is to say it well.

You do not choose the topic, the question, or the difficulty. If the intent
includes a source question or follow-up, use its meaning — you may rephrase
for spoken flow, but you must not change what is being asked, add a second
question, or answer it yourself.

PRODUCE
  acknowledgement — brief, NEUTRAL, and different from the recent ones you
                    are given. Never evaluative: no "great answer", no
                    "perfect", no "not quite". Vary it. Sometimes omit it
                    entirely — a real interviewer does not acknowledge every
                    single answer, and unbroken acknowledgement is its own
                    kind of robotic.
  transition      — only when transition_type is not "none". Bridge from
                    what they just said to where you are going. A topic
                    change is always announced before it happens.
  utterance       — the question itself. Under 35 spoken words. One question.
                    Spoken register: contractions, natural rhythm, no
                    semicolons, no lists, no code.
  prosody         — rate (0.9–1.05), emotion tag, pause points, emphasis
                    words. Pauses go where a person would breathe, not
                    evenly.

TONE RENDERING
  neutral      steady, unhurried, no warmth markers
  encouraging  slower rate, an explicit permission to take time, smaller
               scope. Never pity. Never "don't worry about it" — that
               signals you have written them off.
  warm         acknowledge what they shared before moving on
  brisk        shorter, match their energy, drop the scaffolding
  steady       calm and structured; give them a frame to answer within

RESPONSE STRATEGY RENDERING
  direct           ask it plainly
  scaffold         supply a starting point they can build from
  narrow           name the single specific thing you want
  broaden          open the frame explicitly
  concrete_example ask for a real instance, by name
  rephrase         ask the same thing differently WITHOUT signalling they
                   misunderstood — never "what I meant was"

CALLBACK RENDERING
When callback_memory is present, name the specific thing: "the Pinecone
index", "that 40% number", "the FastAPI service". A callback that does not
name something concrete is not a callback, and it will be rejected.

CORRECTION RENDERING
One sentence. Factual, unevaluative, immediately followed by moving on.
"Quick note — containers on the same user-defined network reach each other
without published ports. Anyway —"

NEVER
- Never evaluate an answer, positively or negatively.
- Never reuse an acknowledgement from recent_acknowledgements.
- Never exceed 35 words in the utterance, except when reading a coding problem.
- Never add a second question.

Return ONLY the utterance plan JSON.
```

**Input**

```json
{
  "intent": { "…": "§3.6 — the full L1 output" },
  "section": { "type": "resume_skills",
               "entry_transitions": ["…"], "exit_transitions": ["…"] },
  "source_text": "Did you write those manifests yourself, or were they already in place?",
  "callback_item": null,
  "runtime": {
    "recent_acknowledgements": ["Got it.", "That makes sense.", "Okay."],
    "turn": 14,
    "last_answer_duration_sec": 67,
    "candidate_hesitation": "moderate"
  },
  "persona": { "name": "warm_professional", "formality": 0.6, "warmth": 0.7, "pace": "measured" }
}
```

**Output** — `utterance_plan`, §3.7

```json
{
  "acknowledgement": "Right, okay.",
  "transition": null,
  "utterance": "Just on that cluster — did you write the manifests yourself, or were they already in place when you joined?",
  "prosody": {
    "rate": 0.96,
    "emotion": "encouraging",
    "pauses_ms": [ { "after_segment": "acknowledgement", "ms": 300 } ],
    "emphasis": ["yourself"]
  },
  "expected_duration_sec": 6.2,
  "allow_barge_in_after_ms": 800,
  "audio": { "source": "cache", "asset_id": "va_fu21_encouraging", "url": "s3://…/va_fu21_encouraging.wav" }
}
```

**Post-validation (deterministic, §4)** — the plan is rejected and resampled if it reuses a recent acknowledgement (R6), exceeds the word cap, contains an evaluative phrase from the banned list (R5), carries a callback without a concrete noun (R3), or omits a required transition on a section change (R10).

**Pre-warming.** While the candidate is still answering, the Orchestrator can speculatively render L4 for the two most likely L1 outcomes — usually "probe the top missing must_have evidence" and "close the goal and open the next". Hit rate in practice is high because the rule layer has already narrowed the field. On a hit, L4 costs zero on the critical path.

**Voice asset resolution.** When the plan's `utterance` exactly matches a bank entry's text and P8 rendered that entry at the plan's tone, L4 attaches the cached `asset_id` and L5 plays it with no synthesis at all. If L4 rephrased the bank text — which it is allowed to do for spoken flow — the cache no longer matches and L5 synthesizes live. **L4 must never adjust its wording to force a cache hit.** Wording serves the candidate; the cache serves latency, and it loses that argument every time.

---

### L5 · Voice Interviewer

| Field | Value |
|---|---|
| **Type** | Pipeline — three deterministic services, **no model of its own** |
| **Runs** | Phase 2, entire interview |
| **Stack** | Streaming STT → semantic end-of-utterance → playback (cached clip or live TTS). Orchestrated by LiveKit Agents or Pipecat |
| **STT** | Deepgram Nova / AssemblyAI Streaming / equivalent — **must return word-level timestamps and per-word confidence** |
| **EOU** | A semantic turn-detection model (LiveKit turn detector, Smart Turn, or equivalent), **not** a fixed VAD timeout |
| **TTS** | ElevenLabs / Cartesia / equivalent, streaming, with a batch mode for P8 pre-synthesis |
| **Recording** | Candidate mic and interviewer output recorded as **separate mono tracks** |
| **Latency target** | <1.2 s from the candidate's last word to the first word of the next utterance |

**Where the "LLM brain" is.** It is L1 and L4, and it is already in this design. The cascade does not add a model — it replaces one opaque speech-to-speech component with three deterministic ones sitting either side of the reasoning that was always there. L5 contains no prompt because it makes no decisions.

```
        🎙 candidate audio
             │
             ├──────────────▶ [ recorder: candidate track ]  ──▶ E1/E2
             ▼
   ┌────────────────────┐   partial transcripts   ┌──────────────────────┐
   │ Streaming STT      │ ──────────────────────▶ │ Semantic EOU model   │
   │ word timestamps    │                         │ "are they finished?" │
   └─────────┬──────────┘                         └──────────┬───────────┘
             │ final transcript + words[]                     │ turn complete
             └───────────────────┬────────────────────────────┘
                                 ▼
                        O1 → L3 → L1 → L4        (§2.2)
                                 │ utterance_plan
                                 ▼
   ┌──────────────────────────────────────────────────────────┐
   │ PLAYBACK                                                 │
   │   plan.audio.source == "cache"  → play P8 asset  (~0 ms) │
   │   plan.audio.source == "live_tts" → stream TTS  (~200 ms)│
   │   log every played segment → playback log (for E1)       │
   └──────────────────────────────────────────────────────────┘
             │
             └──────────────▶ [ recorder: interviewer track ]
```

**Word-level timestamps are native here, and that is the point.** In a speech-to-speech design the candidate audio has to be forked to a second ASR and transcribed again after the session, with two clocks to reconcile. In the cascade, the STT that ran during the interview already produced exactly what E2 needs. Verify this capability with your STT vendor before writing a line of E2 — an STT that returns only segment-level timing makes the entire fluency layer guesswork.

**Separate tracks eliminate diarization.** Candidate mic on one channel, synthesized output on another. There is nothing to separate and no echo bleed to strip.

**End-of-utterance is the hard part, and it is interview-specific**

This is the single component that determines whether the cascade feels human or robotic, and generic settings will fail you. Interview speech has long mid-thought pauses that assistant speech does not:

> *"So the way I'd approach that is… **[4 seconds]** …probably a hash map."*

| Setting | Value | Why |
|---|---|---|
| Silence threshold | 1.5–2.5 s (vs ~700 ms typical) | A candidate thinking is not a candidate finishing |
| Turn detection | Semantic model, not timeout | Detects *"and then I—"* as unfinished regardless of pause length |
| Grammatical-completion bias | Raised | Interview answers trail off; incomplete clauses mean keep waiting |
| Filler-as-continuation | `um`, `so`, `like` at a pause boundary suppress EOU | These are the classic "still thinking" markers |
| Coding mode | EOU suspended entirely | Two minutes of silence while typing is normal, not a turn end |

Tune this against recordings of nervous people thinking, not against yourself reading test sentences. Log every EOU decision with its trigger; false-positive interruptions are the metric to drive down.

**Barge-in handling** — four things must happen, in this order:

1. Stop playback immediately on detected candidate speech.
2. Flush the queued audio buffer, or the interviewer talks over them for another second.
3. Truncate the live TTS stream if one is running.
4. **Log what was actually played, not what was planned** — set `spoke_fully: false` and record the audible prefix. Skipping this step means E4 grades a candidate for failing to answer a question they only heard four words of.

Barge-in is disabled for the first `allow_barge_in_after_ms` of an utterance (default 800 ms) so that a cough or an "mm-hm" does not cancel the question.

**No system prompt.** L5 has no prompt because it has no model. Everything that used to live in a voice agent's instructions now lives where it is enforceable: turn-taking in the EOU configuration above, wording and tone in L4, what to ask in L1, and the ban on evaluative language in §4 R5 as a deterministic post-validation check. **A behaviour that used to be a line in a prompt is now a line of code**, which is the whole reason the cascade suits this architecture.

Two behaviours worth naming explicitly, because they are easy to lose in the translation:

- **Silence prompt.** After 8 s with no speech following an utterance, play one pre-rendered prompt from the shared pool (*"Take your time — or I can rephrase that if it helps."*). Once only. A second prompt reads as pressure.
- **Coding mode.** When the editor opens, play the spoken statement, then suspend EOU and go silent. Do not fill the silence. Hints are played only when O1 dispatches them.

**Turn input** — the utterance plan (§3.7) plus:

```json
{ "session_id": "ses_01H...", "turn": 14, "ui_mode": "voice | editor" }
```

**Turn output → O1**

```json
{
  "session_id": "ses_01H...",
  "question_id": "q_07",
  "asked_at_ms": 852000,
  "spoke_fully": true,
  "answer": {
    "start_ms": 854200, "end_ms": 921450,
    "transcript": "So, umm, I deployed our FastAPI service on a cluster…",
    "interrupted_interviewer": false,
    "silence_before_answer_ms": 2200
  },
  "audio_ref": { "candidate_track": "s3://…/cand.wav", "interviewer_track": "s3://…/int.wav" },
  "playback": { "source": "cache", "asset_id": "va_fu21_encouraging",
                "played_ms": 6200, "planned_ms": 6200, "audible_prefix": null },
  "eou": { "trigger": "semantic_complete", "silence_before_ms": 1900, "false_positive_risk": "low" }
}
```

The `answer.words[]` array comes straight from the streaming STT — there is no second transcription pass and no clock to reconcile. E1 consumes it directly.

`spoke_fully` matters: if the candidate barged in partway through an utterance, E1 must record what was actually *heard*, not what was generated — otherwise E4 grades someone for failing to answer a question they never received in full.

---

## 8. Phase 3 · Evaluation agents

---

### E1 · Transcript Assembly Service

| Field | Value |
|---|---|
| **Type** | Service (deterministic) |
| **Runs** | Phase 3, first |
| **LLM** | None |
| **Tools** | Postgres, streaming-STT word arrays from L5, turn event log, playback log |

**Algorithm**

1. Read the ordered turn log: `utterance_spoken(question_id, t_start, t_end, spoke_fully)`, `answer_started(t)`, `answer_ended(t)`.
2. For each question, slice the **streaming-STT word array captured live by L5** on `[answer_start_ms, answer_end_ms]`. There is no second transcription pass and no clock reconciliation — the timestamps are the ones the interview ran on.
3. Separate candidate/interviewer tracks make bleed removal trivial — no diarization required.
4. Edge cases, handled explicitly:
   - **Interruption of the interviewer** — if `spoke_fully == false`, take `playback.audible_prefix` from L5 as the question text of record, set `partially_heard: true`, and store the full planned text alongside it. E4 grades against the prefix only. This is the failure mode a cascaded stack must handle deliberately: the planned utterance and the heard utterance are different objects.
   - **Candidate barge-in** — clamp `start_ms` to the utterance end, set `interrupted: true`.
   - **Multi-part answers** — resumed after a >4 s gap with no new question: merge into one record, keep the gap in the pause list.
   - **Empty answers** — fewer than 3 words: `status: "skipped"`, excluded from all scoring.
5. Attach `goal_id`, `targets_evidence`, `intent_snapshot`, and `utterance_plan` from the live log so every record is replayable.
6. Emit `question_record[]`.

**Output**

```json
{
  "session_id": "ses_01H...",
  "duration_sec": 905,
  "question_records": [ { "…": "§3.4, fully populated through answer{}" } ],
  "excluded": [ { "question_id": "q_11", "reason": "empty_answer" } ],
  "integrity_flags": [ { "question_id": "q_09", "flag": "partially_heard" } ]
}
```

---

### E2 · Speech Metrics Service

| Field | Value |
|---|---|
| **Type** | Service — **deterministic, no LLM, ever** |
| **Runs** | Phase 3, parallel with E3 |
| **Tools** | Word timestamp array; optional audio energy for a confidence proxy |
| **Cost** | Zero. Do not spend a model call on arithmetic |

Formulas in §9.4. Output:

```json
{
  "question_id": "q_07",
  "raw": {
    "answer_duration_sec": 67.25, "speaking_time_sec": 58.10, "word_count": 142,
    "wpm_gross": 126.7, "wpm_articulation": 146.6,
    "pauses": { "count_over_500ms": 11, "count_over_2s": 2, "mean_ms": 780, "max_ms": 3100, "total_silence_sec": 9.15 },
    "fillers": { "count": 9, "rate_pct": 6.3, "breakdown": { "umm": 4, "like": 3, "you know": 2 } },
    "repetitions": { "count": 2, "rate_pct": 1.4, "examples": ["I think I think"] },
    "time_to_first_word_ms": 2200, "asr_confidence_avg": 0.94
  },
  "bands": { "pace": "slightly_slow", "fillers": "high", "pauses": "acceptable", "hesitation": "acceptable" },
  "sub_scores": { "pace": 8.0, "fillers": 5.0, "pauses": 8.0, "repetition": 9.0 },
  "fluency_score": 7.2,
  "reliability": "high",
  "coaching_notes": [
    "Filler rate of 6.3% is above the 4% target — mostly 'umm' at the start of clauses.",
    "Two pauses over 3 seconds mid-answer; a three-sentence answer skeleton usually fixes this."
  ]
}
```

> **`reliability`** is `low` when `word_count < 25`, `asr_confidence_avg < 0.85`, or `answer_duration_sec < 12`. Low-reliability metrics are shown as observations only and excluded from aggregate fluency.

---

### E3 · Evidence & Knowledge Router

| Field | Value |
|---|---|
| **Type** | Tool-using Agent |
| **Runs** | Phase 3, **only for `grading_mode: "factual"`** |
| **LLM** | Sonnet-class |
| **Tools** | `web_search`, `web_fetch`, company docs index |
| **Budget** | **0 tool calls for `volatility: stable`** (~80% of questions); max 3 otherwise |

| Volatility | Action |
|---|---|
| `stable` | **No search.** The plan-time rubric is ground truth |
| `versioned` | 1–2 searches, prefer official docs |
| `company_specific` | Search the company's own docs/blog |
| Any, plus a contested candidate claim | 1 targeted search to adjudicate |

**System prompt**

```
You decide whether an interview question needs external verification before
grading, and if so you gather it.

Default to NO SEARCH. The rubric was written by a senior engineer at plan
time and is sufficient for stable fundamentals. Search only when:
  - volatility is "versioned" or "company_specific", OR
  - the candidate made a specific factual claim that contradicts the rubric
    and could plausibly be correct (versions change; rubrics go stale).

When you search:
  - Prefer official documentation over blogs and forums.
  - Two sources agreeing beats one source being confident.
  - If sources conflict, report the conflict rather than picking a winner.

Output evidence as short paraphrased findings with source URLs. Paraphrase
in your own words; do not paste blocks of source text.

If the search shows the rubric is outdated, correct it and set
rubric_adjusted: true so the change is auditable.
```

**Output → E4**

```json
{
  "question_id": "q_09", "searched": true, "route_reason": "volatility=versioned",
  "evidence": [ { "finding": "Layouts persist across navigations, so layout state is preserved.",
                  "source_url": "https://nextjs.org/docs/app/…", "source_type": "official_docs", "confidence": "high" } ],
  "rubric_adjusted": false, "adjusted_concepts": [],
  "evidence_confidence": "high | medium | unverified"
}
```

---

### E4 · Answer Grading Agent

| Field | Value |
|---|---|
| **Type** | Agent (observation extraction — **not scoring**) |
| **Runs** | Phase 3, one call per answered question, parallelisable |
| **LLM** | Sonnet-class, `temperature: 0` |
| **Budget** | ~8 s each, 5-way parallel |

**The rule that makes this reliable.** The model reports what it observed; S1 computes the score. Ask a model for "8.5" and you get a different number every run. Ask "was evidence `ev_k8s_ownership` covered — yes, partly, or no" and you get a stable, auditable answer you can convert to a number however you like, and retune later without re-running anything.

**System prompt**

```
You are grading one interview answer against a rubric written before the
interview. You do NOT produce a score. You produce observations. A
deterministic system computes the score from them.

Work in the grading_mode you are given.

FACTUAL — for each expected_concept mark exactly one:
  covered | partial | missing | incorrect
  Quote the exact transcript span justifying covered/partial. List
  incorrect_claims separately with corrections. Ignore fillers and false
  starts — you are grading content, not delivery.

EXPERIENTIAL — you cannot verify the truth of what they built. Assess DEPTH
  and SPECIFICITY only. Mark each expected_signal covered/partial/missing,
  and flag:
    ownership_signal: clear_individual | team_ambiguous | observational
    specificity: numbers, tool names, concrete decisions vs generalities
    consistency: does this contradict prior_answers_summary or
                 memory_contradictions?
  Never mark an experiential answer "incorrect" for content you cannot
  verify. Marking someone wrong about their own project is a serious error.

BEHAVIORAL — STAR completeness plus reflection. Never assess factual
  accuracy. Never judge the choices in the story; assess how clearly they
  were communicated.

FOR ALL MODES also report:
  answered_the_question: true | false   (a fluent answer to a different
    question is a common failure and must be caught)
  hedging_level: none | some | heavy
  notable_strength / notable_gap: one sentence each, or null

CONTEXT YOU ARE GIVEN
  partially_heard — if true, the candidate did not hear the full question.
    Grade only against the portion they heard, and say so.
  evidence_verified_live — what the live tracker matched. Treat it as a
    hint, not as truth; you are the authoritative pass.

Be strict but fair. Non-standard terminology with clear understanding is
covered — you are testing understanding, not vocabulary. Do not penalise
grammar, accent artefacts, or ASR errors; if a word looks mistranscribed,
interpret it charitably.

Return ONLY JSON.
```

**Input**

```json
{
  "question_id": "q_07",
  "question_text": "…",
  "partially_heard": false,
  "grading_mode": "experiential",
  "rubric": { "…": "from P6, possibly adjusted by E3" },
  "evidence": [ { "…": "E3 output, empty if not searched" } ],
  "evidence_verified_live": ["ev_k8s_workload"],
  "answer_transcript": "…",
  "prior_answers_summary": ["Claimed 3 years Python", "Said the k8s cluster was pre-existing"],
  "memory_contradictions": [],
  "difficulty": 3
}
```

**Output → S1, then E5, E6**

```json
{
  "question_id": "q_07",
  "answered_the_question": true,
  "concept_results": [
    { "id": "s1", "evidence_id": "ev_k8s_workload", "status": "covered",
      "evidence_span": "I deployed our FastAPI service", "note": null },
    { "id": "s2", "evidence_id": "ev_k8s_ownership", "status": "partial",
      "evidence_span": "the cluster was already there", "note": "Cluster provenance given; manifest authorship still unstated" }
  ],
  "incorrect_claims": [],
  "depth_signals": { "specificity": "low", "used_concrete_examples": true, "ownership_signal": "team_ambiguous" },
  "hedging_level": "some",
  "consistency_flags": [],
  "notable_strength": "Named the actual service rather than speaking generally.",
  "notable_gap": "Deflected authorship twice; hands-on depth not established.",
  "grader_confidence": 0.9
}
```

---

### E5 · Rewrite Coach Agent

| Field | Value |
|---|---|
| **Type** | Agent (generation) |
| **Runs** | Phase 3, after S1 — **only for questions scoring below 8.5** |
| **LLM** | Sonnet-class |
| **Budget** | Batch 3–5 questions per call |

A single "ideal answer" is demoralising and unusable — the student cannot see the path from what they said to that. The *improved* version is the actionable one: same content, same voice, better structure. Lead the UI with it.

**System prompt**

```
You help a student improve how they answered an interview question. Produce
two versions.

1. IMPROVED — take what the candidate ACTUALLY said and make it better
   without adding knowledge they did not demonstrate. Remove fillers,
   restructure into a clear order, tighten the phrasing, keep their voice
   and their real examples. This must be a realistic version of themselves
   on a better day. Spoken language: contractions are fine; it should sound
   like a person talking, not an essay.

2. IDEAL — a strong answer at this difficulty, covering the must_have
   evidence, 45–90 seconds spoken. Also spoken, not prose.

Then give:
  delta    — the 2–3 specific things separating improved from ideal
  one_thing— the single highest-leverage change, as a concrete action.
             "Give the trade-off before the conclusion" is useful.
             "Be more confident" is not.

Never be condescending. Never say "you were wrong" — state what a stronger
answer includes. The student is practising precisely because they are not
there yet.
```

**Output**

```json
{
  "question_id": "q_07",
  "improved_answer": "So on the Kubernetes side — I deployed our FastAPI service to an existing cluster. I wrote the deployment and service manifests myself and set up an HPA on CPU. The main issue I hit was pods failing readiness because the DB pool warmed up slower than the probe timeout, so I added an initialDelaySeconds and a proper readiness endpoint.",
  "ideal_answer": "I deployed a FastAPI service to a managed cluster. I wrote the deployment, service, and HPA manifests, used a ConfigMap for environment config, and pulled secrets from the cloud secret manager. The lesson was around probes — readiness was failing during startup because the DB pool warm-up outlasted the timeout, which stalled rolling deploys. I split liveness and readiness properly and added a startup probe. If I did it again I'd question whether we needed Kubernetes at all for a single service.",
  "delta": [
    "The ideal answer names the specific resources created, not just 'manifests'.",
    "It closes with a trade-off reflection, which signals seniority.",
    "Neither quantifies anything — one number (pod count, deploy frequency) would strengthen both."
  ],
  "one_thing": "End technical answers with the trade-off you'd reconsider. It turns a description into a judgement, which is what interviewers are listening for."
}
```

---

### E6 · Report Composer

| Field | Value |
|---|---|
| **Type** | Service (assembly) + Agent (narrative only) |
| **Runs** | Phase 3, last |
| **LLM** | Sonnet-class, narrative fields only |
| **Tools** | Postgres, PDF renderer |

All numbers come from S1. **Skill verification claims come from L3's coverage ledger** and the conversation record from L2 — not re-derived from the transcript. The model writes only `summary`, `strengths`, `weaknesses`, and `improvement_plan`, and it is handed the numbers rather than asked to produce them.

**System prompt (narrative portion)**

```
You write the narrative sections of a mock-interview report for a student.
All scores are given and final — never recompute, contradict, or
re-characterise them.

SUMMARY (4–6 sentences): what happened, where they were strong, where they
struggled. Specific, referencing actual questions.

STRENGTHS (2–4): each tied to a specific moment. "Explained the readiness
probe failure with a concrete root cause" — not "good technical knowledge".

WEAKNESSES (2–4): each paired with why it matters in a real interview. Never
moralise. Never comment on accent, grammar, or English proficiency — these
are not interview weaknesses and flagging them is unfair and outside your
remit.

IMPROVEMENT_PLAN (3–5, ranked by leverage): each with a concrete action, an
effort estimate, and a way to know it worked. "Practise answering three
Docker networking questions aloud in under 90 seconds each" beats "study
Docker more".

Tone: a good mentor after a practice session. Honest about gaps, never
discouraging. This student chose to practise — respect that.
```

**Final output**

```json
{
  "session_id": "ses_01H...", "generated_at": "2026-08-07T09:22:00Z",
  "headline": { "overall_score": 6.8, "accuracy_score": 6.4, "communication_score": 7.2,
                "coding_score": 7.0, "readiness_band": "developing",
                "vs_target_role": "Below bar on infrastructure depth; at bar on core backend" },
  "summary": "…",
  "timeline": [ { "t": "00:00", "event": "Interview started", "section": "greeting" } ],
  "goal_outcomes": [
    { "goal_id": "goal_k8s_depth", "statement": "Establish whether the Kubernetes claim is hands-on…",
      "status": "abandoned", "exit_reason": "diminishing_returns", "turns_spent": 4,
      "evidence_verified": 1, "evidence_required": 4,
      "verdict": "Hands-on depth not established after three probes." }
  ],
  "section_scores": [ { "section_id": "sec_03", "title": "Verifying claimed skills", "score": 5.9,
                        "questions": 6, "time_sec": 312 } ],
  "question_breakdown": [ { "question_id": "q_07", "question": "…", "accuracy": 6.5, "fluency": 7.2,
                            "evidence_covered": 1, "evidence_total": 2,
                            "evidence": { "…": "E3" }, "rewrite": { "…": "E5" } } ],
  "skill_verification": [
    { "skill": "Kubernetes", "claimed": "listed_only", "verified_level": "working",
      "gap_vs_jd": "significant", "evidence_question_ids": ["q_07", "q_08"],
      "source": "L3 coverage ledger" }
  ],
  "conversation_quality": {
    "callbacks_made": 2, "goals_closed_by_evidence": 4, "goals_abandoned": 1,
    "note": "Shown internally for tuning; not surfaced to the candidate."
  },
  "speech_analysis": {
    "overall_wpm": 131, "filler_rate_pct": 5.1, "longest_pause_sec": 4.2,
    "trend": "Filler rate rose from 3% to 8% in the second half — a stress signal, not a habit.",
    "note": "Speech metrics are coaching signals, not a measure of competence."
  },
  "strengths": [ { "point": "…", "evidence_question_id": "q_04" } ],
  "weaknesses": [ { "point": "…", "why_it_matters": "…", "evidence_question_id": "q_07" } ],
  "improvement_plan": [
    { "rank": 1, "action": "Deploy a two-service app to a local k3s cluster and write every manifest by hand.",
      "effort": "one weekend", "success_check": "You can explain readiness vs liveness vs startup probes without notes.",
      "addresses": ["Kubernetes depth"] }
  ],
  "next_interview_suggestion": { "focus_areas": ["kubernetes", "postgres_indexing"], "recommended_difficulty": "medium" }
}
```

`goal_outcomes` is new in v2 and is the most useful block in the report. It tells the candidate not just what they scored but **what the interview was trying to find out and whether it succeeded** — which is the actual answer to "how did I do".

---

## 9. S1 · Scoring Engine

Deterministic code. Every number in the product is born here.

### 9.1 Accuracy (factual mode)

```
earned   = Σ over concepts of weight × credit(status)
possible = Σ over concepts of weight
credit:  covered 1.0 · partial 0.5 · missing 0.0 · incorrect 0.0
raw      = earned / possible
penalty  = min(0.25, 0.10 × count(incorrect_claims where severity == "major"))
accuracy = round(max(0, raw − penalty) × 10, 1)
```

Two guards:

- **Must-have floor.** Any `must_have` concept `missing` or `incorrect` caps accuracy at 6.5. An answer missing the core idea is not an 8 because it covered the bonuses.
- **Off-topic.** `answered_the_question == false` caps accuracy at 3.0 and is stated explicitly in the report. If `partially_heard` is set, this guard is suspended — the candidate cannot be penalised for a question they did not hear.

### 9.2 Depth (experiential mode)

```
depth = weighted_coverage × 10
      × ownership_multiplier    # clear_individual 1.0 · team_ambiguous 0.85 · observational 0.7
      × specificity_multiplier  # high 1.0 · medium 0.9 · low 0.75
```

`consistency_flags` and L2 contradictions surface in the report but **never** silently reduce a score — a contradiction may be a mistranscription, and quietly docking points for it is unfair.

### 9.3 Behavioral

```
star = (has_situation + has_task + has_action + has_result) / 4
behavioral = (0.7 × star + 0.3 × reflection_quality) × 10
```

### 9.4 Fluency

```
answer_duration  = last_word_end − first_word_start
pauses           = inter-word gaps > 300 ms
speaking_time    = answer_duration − Σ(pauses)
wpm_articulation = word_count / (speaking_time / 60)
wpm_gross        = word_count / (answer_duration / 60)
```

Band scoring, never linear — both too slow and too fast are problems:

| Metric | 10 | 8 | 6 | 4 |
|---|---|---|---|---|
| WPM (articulation) | 130–165 | 115–130 or 165–180 | 100–115 or 180–200 | <100 or >200 |
| Filler rate | <2% | 2–4% | 4–7% | 7–11% (2 above 11%) |
| Pauses >2s per minute | 0 | ≤1 | ≤2 | >2 |
| Repetition rate | <1% | 1–2.5% | 2.5–5% | >5% |

```
fluency = 0.35×pace + 0.30×filler + 0.20×pause + 0.15×repetition
fluency = null, reliability = "low"  when word_count < 25 or asr_confidence_avg < 0.85
```

**Fairness constraints — do not skip these.** The primary user base speaks English as a second or third language.

1. **Never score pronunciation or accent.** ASR confidence measures accent-model fit, not clarity. Using it as a speaking score penalises exactly the people the product exists to help.
2. **Report fluency separately from competence.** Keep it out of `overall_score` in practice mode; present it as a coaching panel.
3. **Calibrate WPM bands per language variety.** Indian English averages meaningfully lower WPM than US English with no loss of clarity. A US-calibrated band will tell competent speakers they are too slow. Make the band configurable on `inputs.language`.

### 9.5 Coding

```
coding = 0.50×test_pass_rate + 0.20×complexity_match + 0.15×code_quality + 0.15×verbal_reasoning
```

`test_pass_rate` comes from a sandbox run (Judge0 / Piston / firecracker microVM), never from a model's opinion about whether the code works.

### 9.6 Goal and section aggregation

Aggregation is goal-weighted, not question-weighted — a goal that took four questions should not count four times.

```
goal_score     = Σ(question_score × question_weight) / Σ(question_weight)   within the goal
section_score  = Σ(goal_score × goal_priority) / Σ(goal_priority)
accuracy_total = weighted mean over factual + experiential sections
overall (practice)  = 0.55×accuracy + 0.30×coding + 0.15×behavioral
overall (screening) = 0.50×accuracy + 0.25×coding + 0.15×behavioral + 0.10×communication
```

Abandoned goals are scored on the evidence actually gathered and flagged `incomplete` in the report — never scored as zero. Ungraded and low-reliability questions are excluded from all denominators.

---

## 10. Live-loop latency budget

The interview feels broken above roughly 1.5 s of dead air. v2 adds a second blocking model call, so the budget is tighter and the mitigations matter more.

| Stage | Target | Notes |
|---|---|---|
| Streaming STT final transcript | 80–150 ms | Already streaming during the answer; only the tail is new work |
| Semantic end-of-utterance | 300–700 ms | The largest single cost and the one you own in a cascade. Interview-tuned thresholds (L5) |
| Turn ingest + persist (O1) | <40 ms | Pure code |
| L3 Evidence Tracker (fast path) | <40 ms | Lexical + embedding match. No model call |
| §4 rule layer | <10 ms | Array operations |
| **L1 Conversation Manager** | **≤350 ms** | Small model, capped input, capped output |
| §4 post-validation | <5 ms | |
| **L4 Dialogue Styler** | **≤200 ms** | Often 0 ms on a pre-warm hit |
| **Playback start (L5)** | **~0 ms cached · ≤250 ms live TTS** | P8 cache hit on ~60–70% of turns |
| **Total** | **≤1.25 s worst case · ~0.75 s on a cached turn** | |

**Where the cascade wins.** A speech-to-speech model generates every utterance fresh, so its synthesis cost is paid on every turn. Because P6 emits the bank in advance and P8 renders it before the session, the majority of turns here start playing audio the instant L4 returns. That saving is what pays for the second blocking model call added by D2/D3 — the two changes offset each other almost exactly.

Five techniques that buy real headroom:

1. **Acknowledgement cover.** The moment EOU fires, play a short pre-rendered acknowledgement while L1 and L4 run. Buys ~700 ms invisibly. Draw it from a rotating pool so R6 still holds.
2. **Speculative pre-warm.** While the candidate is still answering, render L4 for the two most likely L1 outcomes. The rule layer has already narrowed the field, so hit rates are high.
3. **Hard timeouts with safe defaults.** L1 at 550 ms → `fallback_intent()`. L4 at 350 ms → `neutral_plan()`. A slightly less adaptive turn always beats a stalling one.
4. **L2 stays off the path.** Memory extraction is asynchronous by design and must never be moved inline "just to get fresher callbacks".
5. **P8 pre-synthesis.** Bank questions, transitions, and the acknowledgement pool are already audio before the interview starts. A cache hit removes the entire TTS stage from the turn.

**Failure mode to watch for:** context creep in L1. Its input is deliberately fixed-shape and never contains the transcript. Enforce that in code, not in the prompt — the temptation to "just add a bit more context" is what kills live agents by turn twenty.

---

## 11. Build order

### MVP — 11 components

```
O1  Orchestrator (FSM)                    L1  Conversation Manager
P2  Resume Parser                         L3  Evidence Coverage Tracker
P3  JD Parser                             L4  Dialogue Styler
P6  Interview Blueprint (goals + rubrics) L5  Voice Interviewer (STT · EOU · TTS)
P8  Voice Asset Pre-synthesis
E1+E2  Transcript + Speech Metrics        E4+S1+E5+E6  Grading → Scoring → Rewrite → Report
```

**Build L5's end-of-utterance detection first, before anything else in the live loop.** It is the component most likely to sink the product and the one least visible in a demo. Collect twenty recordings of hesitant answers and tune against them; everything else in Phase 2 can be stubbed while you do.

Deferred initially: P1, P4, P5, P7, L2, E3. Hardcode a strategy template per seniority, let P6 do a light gap analysis inline, disable coding, grade against plan-time rubrics with no web search, and run without memory (callbacks off). This is a complete, useful product with a genuinely goal-driven interview.

**L3 is in the MVP and L2 is not** — that ordering is deliberate. Evidence-driven section completion is what makes the interview feel non-scripted; memory callbacks are what make it feel attentive. The first is structural, the second is delightful. Build structure first.

### v1.1 — attentiveness

Add **L2 Structured Interview Memory**. Callbacks are the single largest "this feels real" upgrade per line of code in the entire system, and L1 already has the input slot for them.

### v1.2 — depth

Add **P4** and **P5** (goal relevance improves noticeably), then **P1** (company context) and **E3** (web evidence for versioned topics).

### v1.3 — breadth

Add **P7 Coding Challenge** and the editor mode in L5.

### v2 — screening mode

Integrity checks, calibration against human interviewer scores, panel interviews, ATS export.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Latency creep in L1** as the session grows | Fixed-shape input, never the transcript. Enforced in code |
| **Two blocking calls per turn** exceeding budget | Acknowledgement cover + L4 pre-warm + hard timeouts with safe defaults (§10) |
| **L1 picking illegal actions** | It cannot — §4 pre-filters the candidate set and post-validates the output. Rules are code |
| **Goals that never close** (endless probing) | Every goal carries mandatory `diminishing_returns`, `time_ceiling`, and `distress` exit conditions; O1 enforces section and total ceilings above all of it |
| **L3 fast-path false positives** (marking evidence verified on a lexical match) | Async refinement pass corrects marks before the next turn; evaluation reads refined state only |
| **Memory callbacks that feel gimmicky** | R3 caps at one per three turns, never consecutive, and requires a concrete noun |
| **Interviewer sounds warm but says nothing** | L4 cannot change the question; it only wraps it. Substance is L1's and P6's responsibility |
| **Rubric staleness** for versioned topics | `volatility` tag + E3; regenerate `versioned` rubrics at session time rather than serving from cache |
| **Score drift** between runs | E4 emits observations, S1 computes numbers, `temperature: 0`, rubric version logged with every score |
| **Accent / ESL bias in fluency** | §9.4 constraints; bands configurable per language variety; pronunciation never scored |
| **Over-probing a struggling candidate** | R9 recovery policy + `distress` exit condition + the two-strike "I don't know" rule |
| **ASR mistranscription graded as a wrong answer** | E4 instructed to interpret charitably; low-confidence answers badged in the report |
| **EOU false positives on hesitant speech** | The primary risk of a cascaded stack. Semantic turn detection, interview-tuned thresholds, filler-as-continuation suppression (L5). Log every EOU decision and drive false interruptions down as a tracked metric |
| **Barge-in leaving a mismatched question of record** | L5 records `audible_prefix` and `spoke_fully`; E1 grades against the prefix; §9.1 suspends the off-topic guard when `partially_heard` |
| **STT without word-level timestamps** | Hard vendor requirement. Verify before building E2 — segment-level timing makes the entire fluency layer guesswork |
| **Stale voice cache** (L4 rephrases, cached clip says something else) | Exact text equality check in P8's resolver; on mismatch, always synthesize live. Never play a clip whose text differs from the plan |
| **Cost per interview** | Plan-time rubrics · `stable`-volatility no-search · small models on L1/L2/L4 · company profile caching. Most spend sits in Phase 1, which is cacheable and shareable |
| **Coding problem defects** | Curated bank over generation; reference solutions validated against hidden tests in a sandbox |

---

## 13. Architectural invariants

If any of these ever becomes false, the design has drifted and something is wrong.

1. **O1 contains no model call.** Routing is not intelligence.
2. **L1 never emits a sentence.** Structured intent only.
3. **L4 never chooses a topic.** Wording only.
4. **P6 never emits an emotion tag.** Delivery is L4's alone.
5. **L5 decides nothing.** It speaks the plan it is given.
6. **Rubrics are generated before the interview**, never after.
7. **Models emit observations; S1 emits numbers.**
8. **Sections end on evidence** (§4/L3); time and count budgets are ceilings, not the primary rule.
9. **`grading_mode` is assigned at plan time** and never changes. Factual accuracy is never applied to experiential or behavioral answers.
10. **Exactly two blocking model calls per turn.** L1 and L4. Everything else is deterministic or queued.
11. **Every conversational rule in §4 is enforced in code**, not requested in a prompt.
12. **Every live-loop component has a fallback that degrades texture, never termination.**
13. **Fluency is a coaching signal**, reported separately from competence, never scored on pronunciation.
14. **Every turn is replayable** from `intent_snapshot` + `utterance_plan` + coverage state at that turn.
15. **L5 contains no model and no prompt.** STT, end-of-utterance, and playback only.
16. **Word-level timestamps come from the live STT**, not a second transcription pass.
17. **A cached clip is played only when its text exactly matches the utterance plan.** Wording is never adjusted to force a cache hit.
18. **What was heard, not what was planned, is the question of record** whenever `spoke_fully` is false.
