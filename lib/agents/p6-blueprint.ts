/**
 * P6 · Interview Blueprint Agent
 *
 * The most important agent in the system. It converts the strategy into GOALS —
 * evidence requirements with their grading rubrics, completion criteria, exit
 * conditions, per-section briefs — which drive all ~25 live turns and the whole
 * evaluation phase.
 *
 * Design decision D1: this emits goals, not a script. Nothing in the output
 * implies an order.
 *
 * ── Why this is many calls and not one ───────────────────────────────────────
 * It used to be a single `deep`-tier call producing the entire blueprint. That
 * is 8-17k tokens of deeply nested JSON on top of a 25k reasoning budget,
 * generated as one sequential stream, and it reliably ran past three minutes and
 * timed out — taking the whole session with it.
 *
 * Nothing about the work required it to be sequential. Sections do not read each
 * other; they are independent investigations that happen to share a candidate.
 * So the blueprint is now assembled from parts:
 *
 *   context   — built in code from P2/P3/P4 output. No model call at all.
 *   intro     — built in code. A warm-up is formulaic and must not be left to chance.
 *   coding    — built in code. Its content is P7's challenge, not a question bank.
 *   closing   — built in code. It is a goodbye.
 *   the rest  — one model call each, all in parallel.
 *
 * The slowest section is now the whole cost rather than their sum, and a typical
 * blueprint lands in ~25s instead of timing out at 180s.
 *
 * ── It writes the map, not the route ─────────────────────────────────────────
 * The live interviewer (lib/agents/interviewer.ts) writes its own questions
 * against what the candidate actually says. Two consequences shape this file:
 *
 *   Rubrics hang off EVIDENCE, not off questions. A rubric pinned to one
 *   sentence would grade nothing, because that sentence is not what gets asked.
 *
 *   The `context` block carries the resume and JD digests. The live loop never
 *   sees either document, so what is written there is the only thing standing
 *   between a question that names the candidate's own project and one that says
 *   "tell me about a project you worked on".
 *
 * Invariants enforced below:
 *   #4 — no emotion tags. Delivery is the live interviewer's.
 *   #6 — rubrics generated before the interview, never after.
 *   #9 — grading_mode assigned here and never changed.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { SECTION_QUESTION_BUDGET } from '../engine/types';
import { DIFFICULTY_BRIEF, skillMixBrief } from './p5-strategy';
import {
  blueprintSectionSchema,
  type Blueprint,
  type BlueprintContext,
  type BlueprintSection,
  type CompanyProfile,
  type GapReport,
  type JdProfile,
  type ResumeProfile,
  type Strategy,
} from './schemas';

const SECTION_SYSTEM = `You design ONE section of a voice mock interview. You are not writing a script and you are not writing the questions the candidate will hear. You are writing the map: what the interviewer needs to find out in this stretch of the conversation, what counts as having found it out, and what a good answer contains.

A DIFFERENT model conducts the live interview. It is fast, and it writes its own questions in the moment against what the candidate actually says. It will never see the resume or the job description — it sees only what you write here and a short digest it is given separately. Write for that reader: concrete, specific, and short enough to be read on every turn.

## Goals, not questions

A goal is a destination. A question is a route. You provide destinations; the live interviewer finds the route.

Every goal needs:
- statement: what this goal must ESTABLISH, phrased as a finding, not a topic.
    good: "Establish whether the Kubernetes claim is hands-on implementation or observational exposure."
    bad:  "Ask about Kubernetes."
- evidence_required: 2-4 specific, observable things a candidate would say if the claim were true. These are the join key for the entire system — the live interviewer aims at them, the evidence tracker marks them off, the report's coverage rows come from them, and they are what the answer is graded against. Write them as observable behaviours ("Names the specific workload deployed"), never as qualities ("Shows good understanding").
- completion_criteria.required_evidence: only the must_have items. A goal is done when the core is established, not when every bonus is collected.
- exit_conditions: when to give up. Always set these — a goal with no exit is a goal that eats the interview.

## The section brief — objective, question_focus, must_verify

Three fields the live interviewer reads before it asks anything.

- objective: one sentence on what this section is for. "Find out whether the data-engineering experience on the resume is real depth or exposure."
- question_focus: the KINDS of question to ask here. Name them plainly: "resume verification against their Spark work", "skill check on distributed processing fundamentals", "applied judgement on pipeline failure".
- must_verify: what has to be established before the section is done, in plain language. The goal evidence restated so the interviewer can hold it in mind while talking.

## Seed questions

Two or three per goal, NOT a playlist. The live interviewer writes its own; these exist to set the pitch, to be spoken from cache when the section opens, and to be the fallback if the live model fails. Make them good, make them few.

Vary entry_style: direct asks plainly, story asks for a specific incident, hypothetical poses a situation, comparative asks them to choose between two options and justify it.

### This section needs all three KINDS of question

Questions that are only "tell me about your project" cannot distinguish someone who built the thing from someone who watched it being built. Cover:

1. RESUME VERIFICATION — anchored to something they actually claim. "Your resume says you cut p99 latency by 40% on the checkout service — what was the bottleneck?" grading_mode: experiential.

2. SKILL CHECK — a direct test of the concept itself, with NO reference to their work. This is the kind most often missing, so write at least ONE and give it grading_mode "factual". It must be answerable by someone who understands the topic and not by someone who has only used a library that does it:
     "What is RAG? Walk me through what happens between a user's question and the answer."
     "In Python, when would you reach for a generator instead of a list?"
     "What does an index actually cost you on writes?"
   Never ask for a definition that could be recited; ask for the mechanism, or when you would and would not use it.

3. APPLIED JUDGEMENT — a hypothetical or comparative that makes them choose and defend. "Your retrieval returns the right document but the answer cites the wrong section — where do you look first?" grading_mode: factual.

- targets_evidence links each question to what it is trying to surface. Be accurate; the interviewer selects by gap.
- Questions must be speakable. This is voice — a candidate hears it once. One question per question. No multi-part questions, no parentheticals, nothing over about 30 words.

### Every question carries its own frame

The interviewer moves between topics, and a question may follow an unrelated one. A question that assumes the previous one is still in the air gets answered at the wrong scope, and is then graded as if the candidate misunderstood. So each question names its own subject:
  "In your resume you list Hyrzo — how did you implement retrieval in it?"    ← clearly their project
  "Setting your own work aside for a second — what is a transformer model?"   ← clearly general
  "How did you implement RAG?"                                                ← ambiguous, avoid

## Rubrics live on the EVIDENCE, not on the question

The wording that gets asked is not yours, so a rubric attached to one sentence would grade nothing. The grading contract belongs to the thing being established.

Every evidence_required item carries:
- expected_signals: 1-4 things a good answer contains for THIS evidence item. Concrete and checkable.
- accept_if_candidate_says: literal phrases or close variants that count. These are matched against a spoken transcript, so write how people actually talk — "the cluster was already there", "I wrote the helm charts" — not formal terminology.
- grading_mode, permanent once set:
    factual — there is a correct answer.
    experiential — about their own work. Scored on depth and specificity, NEVER marked wrong. Anything referencing their resume is experiential.
    behavioral — about how they worked with people. Scored on STAR structure.
  Getting this wrong means an answer about someone's own project is graded against a factual rubric, which is both incorrect and unfair.
- volatility: "stable" for fundamentals unchanged in a decade, "versioned" for anything tied to a release, "volatile" for actively-moving topics. Stable items never trigger a web lookup later, which is much of what keeps this affordable — so do not mark something versioned unless it truly is.

A goal whose evidence is a mix of modes is fine and normal.

## The gap classes, and what each one is for

The gaps are given to you in three groups, and they want different questions:

- STRONG — the resume evidences this. The question is not "have you done it" but how deep it goes: the decision they made, the thing that broke, what they would do differently. These are where a candidate demonstrates competence, and an interview with none of them produces a report that establishes nothing.
- WEAK — the role needs it and the resume only gestures at it. The most productive band: enough to talk about, not enough to be sure.
- NOT ESTABLISHED (UNVERIFIED / MISSING) — nothing corroborates it. Ask directly and plainly. If they have not done it, that is a finding, not a failure — write exit_conditions that let the goal close gracefully rather than pressing someone on something they have already said they have not touched.

Never build a goal around a SURPLUS skill; the role does not need it.

You are given a target split for the interview as a whole. Your section serves its own purpose first — but within that purpose, let the split decide which skills you reach for.

## Difficulty is a ceiling, and it is given to you

You are told the interview's difficulty. It bounds how hard anything in this section may be — the seed questions, the evidence you require, and the depth in completion_criteria. An easy interview asking one hard question wastes the question and rattles the candidate for everything after it; a hard interview that never leaves recall establishes nothing worth reporting. Size the goals to the ceiling you were given.

## If this section is type "behavioral"

It is about how they work with PEOPLE, and nothing else. Not "tell me about a hard bug" — that is a technical question. Conflict with a colleague, a decision they had to sell, something that went wrong on their watch, feedback that landed badly.

- Write at least TWO goals. Two behavioural answers is the minimum this section exists to produce.
- EVERY evidence item must be grading_mode "behavioral". No exceptions, and no factual item mixed in — a behavioural section is the one place the "at least one factual item" rule does not apply. The grader fills in STAR fields only for this mode, and an item marked factual here is an item that scores nothing.
- Write evidence that STAR can actually be read off: the situation they were in, what was theirs to do, what they personally did, how it ended. Name the four separately rather than as one lump.
- Seed questions ask for one specific incident, not a policy. "Tell me about a time a code review turned into a disagreement" is a question. "How do you handle conflict?" invites a rehearsed answer that establishes nothing.

## Transitions

entry_transitions and exit_transitions are how the interviewer enters and leaves this section. Plain and conversational. They must contain NO emotional direction, no stage instructions, and no bracketed tags — how something is delivered is decided elsewhere; you only supply words.

## Ids

Every id you write must be unique within this section and descriptive: goal_spark_depth, ev_spark_authored, sig_spark_wrote_jobs, qb_spark_1.`;

export interface BlueprintInput {
  strategy: Strategy;
  gap: GapReport;
  resume: ResumeProfile;
  /** Needed for the context block's jd_summary — the live loop never sees the JD. */
  jd: JdProfile;
  company?: CompanyProfile | null;
  roleTitle: string;
  companyName: string;
  seniority: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** What the candidate asked for on the setup screen. Usually empty. */
  focusSkills?: string[];
}

/**
 * The gap report's five statuses, collapsed to the three classes the mix quota
 * is expressed in.
 *
 * UNVERIFIED and MISSING are one class because they are the same thing to an
 * interview: the resume does not establish it, so the only way to find out is
 * to ask. SURPLUS is not a class — it is excluded everywhere.
 */
export function gapClass(status: string): 'strong' | 'weak_medium' | 'not_established' | null {
  if (status === 'STRONG') return 'strong';
  if (status === 'WEAK') return 'weak_medium';
  if (status === 'UNVERIFIED' || status === 'MISSING') return 'not_established';
  return null;
}

// ── The context block, built rather than generated ───────────────────────────

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * The digest the live interviewer reads on every turn.
 *
 * ── Why there is no model call here any more ─────────────────────────────────
 * P2, P3 and P4 already produced this information as structured data. Asking a
 * model to read that structure and write prose summarising it added latency to
 * the critical path and could only ever LOSE information — a paraphrase of a
 * parsed field is strictly worse than the field.
 *
 * The one thing the prose bought was readability, and that turned out not to
 * matter: the reader is another model, and a dense factual line is easier for it
 * to use than a flowing sentence. Project names and claims now reach the live
 * interviewer exactly as the resume stated them, rather than as a summary of a
 * summary.
 */
function buildContext(input: BlueprintInput): BlueprintContext {
  const topSkills = input.jd.required_skills
    .slice()
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10)
    .map((s) => s.skill);

  const jdSummary = clip(
    [
      `${input.jd.role_title} (${input.jd.seniority}).`,
      topSkills.length ? `Requires: ${topSkills.join(', ')}.` : '',
      input.jd.responsibilities.length
        ? `Responsibilities: ${input.jd.responsibilities.slice(0, 5).join('; ')}.`
        : '',
      input.jd.domain_knowledge.length ? `Domain: ${input.jd.domain_knowledge.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    700,
  );

  const current = input.resume.experience[0];
  const resumeSummary = clip(
    [
      input.resume.headline ?? '',
      input.resume.years_experience !== null ? `${input.resume.years_experience} years experience.` : '',
      current ? `Currently ${current.title} at ${current.company}.` : '',
      current?.highlights.length ? `Recent work: ${current.highlights.slice(0, 3).join('; ')}.` : '',
      input.resume.skills.length
        ? `Claims: ${input.resume.skills.slice(0, 15).map((s) => s.skill).join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    700,
  );

  const companySummary = input.company
    ? clip(
        [
          input.company.one_liner,
          input.company.tech_stack.length
            ? `Stack: ${input.company.tech_stack.slice(0, 10).map((t) => t.technology).join(', ')}.`
            : '',
          input.company.interview_emphasis.length
            ? `Probes hardest on: ${input.company.interview_emphasis.slice(0, 4).join('; ')}.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        400,
      )
    : // Never invented. An empty string is what the live prompt checks for.
      '';

  return {
    role_title: input.roleTitle,
    company_name: input.companyName,
    seniority: input.seniority,
    jd_summary: jdSummary,
    resume_summary: resumeSummary,
    company_summary: companySummary,
    candidate_projects: input.resume.projects.slice(0, 5).map((p) => ({
      name: p.name,
      one_line: clip([p.summary, p.impact ?? ''].filter(Boolean).join(' '), 200),
      technologies: p.technologies.slice(0, 8),
    })),
    claims_worth_probing: input.resume.claims_worth_probing
      .slice()
      .sort((a, b) => b.probe_value - a.probe_value)
      .slice(0, 6)
      .map((c) => clip(c.claim, 200)),
    priority_skills: input.strategy.priority_skills.slice(0, 10),
    focus_skills: (input.focusSkills ?? []).slice(0, 10),
    /*
     * The gap verdict per skill, most worth investigating first.
     *
     * The live interviewer never sees the gap report, so before this it could
     * not tell a skill the resume proves from one it never mentions — and those
     * two want completely different questions. SURPLUS is filtered out: the role
     * does not need it, so a question about it measures nothing.
     */
    skill_status: input.gap.skills
      .filter((sk) => gapClass(sk.status) !== null)
      .slice()
      .sort((a, b) => b.investigation_priority - a.investigation_priority)
      .slice(0, 16)
      .map((sk) => `${sk.skill} · ${sk.status}`),
  };
}

// ── Sections built in code ───────────────────────────────────────────────────

/**
 * The warm-up.
 *
 * Built here rather than generated, and this is not negotiable: it is the first
 * thing the candidate hears, and a hard technical question in the opening thirty
 * seconds rattles people so that every measurement taken afterwards is degraded.
 * Too important to leave to instruction-following, and formulaic enough that
 * there is nothing for a model to add. Also saves a call on the critical path.
 */
function warmUpSection(): BlueprintSection {
  return {
    section_id: 'sec_intro',
    type: 'intro',
    title: 'Getting started',
    time_budget_sec: 75,
    time_ceiling_sec: 120,
    entry_transitions: ["Thanks for making the time — let's start easy."],
    exit_transitions: ["That's a good place to start. Let's get into the role itself."],
    objective: 'Settle the candidate before anything is investigated.',
    question_focus: ['open personal question about their recent work'],
    must_verify: ['what they currently work on'],
    goals: [
      {
        goal_id: 'goal_intro',
        priority: 0.3,
        skill_tags: [],
        statement: 'Get the candidate talking comfortably before anything is investigated.',
        evidence_required: [
          {
            evidence_id: 'ev_intro_current',
            description: 'Says what they currently work on',
            tier: 'must_have',
            weight: 1,
            expected_signals: [
              {
                id: 'sig_intro_current',
                signal: 'Names what they currently work on',
                accept_if_candidate_says: ['I work', "I'm working", 'currently', 'my role', 'I build'],
              },
            ],
            // An answer about themselves cannot be marked wrong.
            grading_mode: 'experiential',
            volatility: 'stable',
          },
          {
            evidence_id: 'ev_intro_context',
            description: 'Gives some background on how they got there',
            tier: 'good_to_have',
            weight: 1,
            expected_signals: [
              {
                id: 'sig_intro_context',
                signal: 'Gives some account of how they got to their current work',
                accept_if_candidate_says: ['started', 'before that', 'I moved', 'joined', 'studied'],
              },
            ],
            grading_mode: 'experiential',
            volatility: 'stable',
          },
        ],
        completion_criteria: {
          required_evidence: ['ev_intro_current'],
          // Low bar on purpose: this goal should close after one answer.
          min_confidence: 0.3,
          min_depth: 'surface',
        },
        exit_conditions: {
          no_new_evidence_for_turns: 1,
          max_turns: 2,
          allow_candidate_disclaim: true,
        },
        question_bank: [
          {
            bank_id: 'qb_intro_1',
            text: "To start — tell me a bit about yourself and what you've been working on lately.",
            targets_evidence: ['ev_intro_current', 'ev_intro_context'],
            difficulty: 1,
            grading_mode: 'experiential',
            entry_style: 'direct',
          },
        ],
      },
    ],
  };
}

/**
 * The coding and skill-challenge sections.
 *
 * Built in code because their content is not a question bank — it is P7's
 * challenge, which the candidate reads on screen. What the blueprint has to
 * supply is a shell: a handoff line, and one goal whose evidence carries the
 * right grading_mode so the submission is scored as coding or skill rather than
 * falling through to experiential.
 *
 * That grading_mode has broken before, twice, when it was left to a model or a
 * default. Here it cannot: the section type decides it, in one expression.
 */
function moduleSection(
  planned: Strategy['sections'][number],
  index: number,
  kind: 'coding' | 'skill_challenge',
): BlueprintSection {
  const coding = kind === 'coding';
  const id = `sec_${kind}`;

  return {
    section_id: id,
    type: kind,
    title: planned.title || (coding ? 'Coding' : 'Hands-on task'),
    time_budget_sec: Math.round(planned.minutes * 60),
    time_ceiling_sec: Math.round(planned.minutes * 60 * 1.25),
    entry_transitions: [
      coding
        ? "Let's switch to some code — I'm putting a problem on your screen now."
        : "Let's do something hands-on — I'm putting a task on your screen now.",
    ],
    exit_transitions: ["Good. Let's talk about what you wrote."],
    objective: coding
      ? 'Measure algorithmic reasoning on a problem solved in the editor.'
      : 'Measure whether they can actually work in the technology this role requires.',
    question_focus: [coding ? 'coding problem in the editor' : 'hands-on task in the editor'],
    must_verify: [
      coding ? 'that they can reach a working solution and explain it' : 'that they can produce working code in this technology',
    ],
    goals: [
      {
        goal_id: `goal_${kind}_${index}`,
        priority: 0.9,
        skill_tags: [],
        statement: coding
          ? 'Establish how the candidate reasons through an algorithmic problem and explains their approach.'
          : 'Establish whether the candidate can do the hands-on work this role requires.',
        evidence_required: [
          {
            evidence_id: `ev_${kind}_submission`,
            description: coding
              ? 'Submits a solution and explains the approach and its complexity'
              : 'Submits working code and explains the choices behind it',
            tier: 'must_have',
            weight: 3,
            expected_signals: [
              {
                id: `sig_${kind}_approach`,
                signal: 'Explains the approach out loud while working, not only afterwards',
                accept_if_candidate_says: ['I would', "I'm going to", 'the idea is', 'first I', 'because'],
              },
            ],
            // The whole reason this section is built in code (invariant 9).
            grading_mode: coding ? 'coding' : 'skill',
            volatility: 'stable',
          },
        ],
        completion_criteria: {
          required_evidence: [`ev_${kind}_submission`],
          min_confidence: 0.5,
          min_depth: 'implementation',
        },
        exit_conditions: {
          no_new_evidence_for_turns: 2,
          max_turns: 4,
          allow_candidate_disclaim: false,
        },
        question_bank: [
          {
            bank_id: `qb_${kind}_1`,
            text: coding
              ? 'Talk me through your approach before you start typing.'
              : 'Before you start — how are you thinking about this one?',
            targets_evidence: [`ev_${kind}_submission`],
            difficulty: 3,
            grading_mode: coding ? 'coding' : 'skill',
            entry_style: 'direct',
          },
        ],
      },
    ],
  };
}

/**
 * The behavioural round, built in code when the strategy did not plan one.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `config.modules.behavioral` was set to true when a session was created and
 * then read by absolutely nothing: it never reached P5, so whether an interview
 * had a behavioural section at all came down to whether the model felt like
 * planning one. When it did not, no question was ever graded `behavioral`,
 * `aggregateSession` averaged an empty set to null, and `computeReadiness`
 * turned that null into a flat **0** on the report — which is what a candidate
 * saw after answering nothing behavioural at all.
 *
 * P5 is now told to always plan one. This is the belt to that braces: two goals,
 * four STAR-shaped evidence items each carrying grading_mode "behavioral", so
 * the dimension is measurable even if generation drifts.
 */
function behaviouralSection(minutes: number): BlueprintSection {
  /** One goal. `key` keeps the ids unique and readable in the transcript. */
  const goal = (
    key: string,
    statement: string,
    prompt: string,
    second: string,
  ) => ({
    goal_id: `goal_behavioral_${key}`,
    priority: 0.7,
    skill_tags: ['collaboration'],
    statement,
    evidence_required: [
      {
        evidence_id: `ev_behavioral_${key}_situation`,
        description: 'Describes a specific situation and what was theirs to do in it',
        tier: 'must_have' as const,
        weight: 2,
        expected_signals: [
          {
            id: `sig_behavioral_${key}_situation`,
            signal: 'Names one concrete incident rather than describing a general policy',
            accept_if_candidate_says: ['there was a time', 'we had', 'on one project', 'last year', 'my manager'],
          },
        ],
        grading_mode: 'behavioral' as const,
        volatility: 'stable' as const,
      },
      {
        evidence_id: `ev_behavioral_${key}_action`,
        description: 'Says what THEY personally did, not what the team did',
        tier: 'must_have' as const,
        weight: 3,
        expected_signals: [
          {
            id: `sig_behavioral_${key}_action`,
            signal: 'Uses "I" about the decisive action, and says why they chose it',
            accept_if_candidate_says: ['I decided', 'I went to', 'I suggested', 'so I', 'I told them'],
          },
        ],
        grading_mode: 'behavioral' as const,
        volatility: 'stable' as const,
      },
      {
        evidence_id: `ev_behavioral_${key}_result`,
        description: 'Says how it ended and what they took from it',
        tier: 'good_to_have' as const,
        weight: 2,
        expected_signals: [
          {
            id: `sig_behavioral_${key}_result`,
            signal: 'Gives the outcome and some reflection on it',
            accept_if_candidate_says: ['in the end', 'it worked', 'looking back', 'I would now', 'we shipped'],
          },
        ],
        grading_mode: 'behavioral' as const,
        volatility: 'stable' as const,
      },
    ],
    completion_criteria: {
      required_evidence: [`ev_behavioral_${key}_situation`, `ev_behavioral_${key}_action`],
      min_confidence: 0.5,
      min_depth: 'working' as const,
    },
    exit_conditions: {
      no_new_evidence_for_turns: 2,
      max_turns: 3,
      allow_candidate_disclaim: true,
    },
    question_bank: [
      {
        bank_id: `qb_behavioral_${key}_1`,
        text: prompt,
        targets_evidence: [`ev_behavioral_${key}_situation`, `ev_behavioral_${key}_action`],
        difficulty: 2,
        grading_mode: 'behavioral' as const,
        entry_style: 'story' as const,
      },
      {
        bank_id: `qb_behavioral_${key}_2`,
        text: second,
        targets_evidence: [`ev_behavioral_${key}_result`],
        difficulty: 2,
        grading_mode: 'behavioral' as const,
        entry_style: 'direct' as const,
      },
    ],
  });

  return {
    section_id: 'sec_behavioral',
    type: 'behavioral',
    title: 'Working with people',
    time_budget_sec: Math.round(Math.max(4, minutes) * 60),
    time_ceiling_sec: Math.round(Math.max(4, minutes) * 60 * 1.25),
    entry_transitions: ["Let's step away from the technical side for a bit."],
    exit_transitions: ['Thanks — that gives me a good sense of how you work with people.'],
    objective: 'Establish how the candidate works with other people when it is difficult.',
    question_focus: ['a specific disagreement they had to resolve', 'something that went wrong on their watch'],
    must_verify: ['one concrete incident with their own actions in it', 'how it ended and what they took from it'],
    goals: [
      goal(
        'conflict',
        'Establish how they handle disagreement with someone they work with.',
        'Tell me about a time you disagreed with someone on your team about how to build something. What happened?',
        'How did that land with them afterwards?',
      ),
      goal(
        'setback',
        'Establish how they respond when something they owned went wrong.',
        "Tell me about something you shipped that didn't go the way you expected. What did you do?",
        'What would you do differently if it came round again?',
      ),
    ],
  };
}

/** The close. A goodbye and a chance for their questions — formulaic by nature. */
function closingSection(planned: Strategy['sections'][number]): BlueprintSection {
  return {
    section_id: 'sec_closing',
    type: 'closing',
    title: planned.title || 'Wrapping up',
    time_budget_sec: Math.max(60, Math.round(planned.minutes * 60)),
    time_ceiling_sec: Math.max(90, Math.round(planned.minutes * 60 * 1.5)),
    entry_transitions: ["That's most of what I wanted to cover."],
    exit_transitions: ['Thanks for your time today — that was a good conversation.'],
    objective: 'Close the interview and give the candidate room to ask anything.',
    question_focus: ['open invitation for their questions'],
    must_verify: ['that they had a chance to ask what they wanted'],
    goals: [
      {
        goal_id: 'goal_closing',
        priority: 0.2,
        skill_tags: [],
        statement: 'Give the candidate space to ask about the role before ending.',
        evidence_required: [
          {
            evidence_id: 'ev_closing_questions',
            description: 'Was given the chance to ask questions',
            tier: 'good_to_have',
            weight: 1,
            expected_signals: [
              {
                id: 'sig_closing_questions',
                signal: 'Asks something, or declines',
                accept_if_candidate_says: ['I wanted to ask', 'no questions', "I'm good", 'what about'],
              },
            ],
            grading_mode: 'experiential',
            volatility: 'stable',
          },
        ],
        completion_criteria: {
          required_evidence: ['ev_closing_questions'],
          min_confidence: 0.2,
          min_depth: 'surface',
        },
        exit_conditions: { no_new_evidence_for_turns: 1, max_turns: 2, allow_candidate_disclaim: true },
        question_bank: [
          {
            bank_id: 'qb_closing_1',
            text: 'Before we finish — is there anything you wanted to ask me about the role?',
            targets_evidence: ['ev_closing_questions'],
            difficulty: 1,
            grading_mode: 'experiential',
            entry_style: 'direct',
          },
        ],
      },
    ],
  };
}

// ── Fallback section generator ───────────────────────────────────────────────

/**
 * Synthesises a schema-compliant conversational section from the strategy and gap
 * report if the model call times out or encounters an unrecoverable failure.
 *
 * Invariant 12: degrade texture, never terminate.
 * A dropped conversational section causes the live interviewer to skip the topic
 * entirely — in shorter interviews with modules (coding / skill challenge), dropping
 * the lone conversational section strips 100% of technical questions.
 * This synthesises concrete goals, rubrics, signals and seed questions directly
 * from the candidate's gap skills and claimed projects.
 */
function buildFallbackSection(
  input: BlueprintInput,
  planned: Strategy['sections'][number],
  index: number,
  ctx: BlueprintContext,
): BlueprintSection {
  const timeBudgetSec = Math.round(planned.minutes * 60);
  const timeCeilingSec = Math.round(planned.minutes * 60 * 1.25);
  const sectionId = `${planned.type}_${index + 1}`;

  // Find the highest-priority skills relevant to this section
  const candidateSkills = input.gap.skills
    .filter((s) => s.status !== 'SURPLUS')
    .sort((a, b) => b.investigation_priority - a.investigation_priority);

  const topSkills = candidateSkills.slice(0, 2).map((s) => s.skill);
  const targetSkills = topSkills.length > 0 ? topSkills : (ctx.priority_skills.slice(0, 2).length ? ctx.priority_skills.slice(0, 2) : [input.roleTitle]);

  const goals = targetSkills.map((skill, sIdx) => {
    const goalId = `goal_${planned.type}_${index + 1}_${sIdx + 1}`;
    const evImplId = `ev_${planned.type}_${index + 1}_${sIdx + 1}_impl`;
    const evConceptId = `ev_${planned.type}_${index + 1}_${sIdx + 1}_concept`;

    return {
      goal_id: goalId,
      priority: 0.8,
      skill_tags: [skill],
      statement: `Establish candidate hands-on depth, implementation experience, and architectural trade-offs in ${skill}.`,
      evidence_required: [
        {
          evidence_id: evImplId,
          description: `Explains how they implemented or worked with ${skill} in actual projects`,
          tier: 'must_have' as const,
          weight: 2,
          expected_signals: [
            {
              id: `sig_${planned.type}_${index + 1}_${sIdx + 1}_impl`,
              signal: `Names concrete tools, patterns, or architecture decisions used with ${skill}`,
              accept_if_candidate_says: [
                'I implemented',
                'we designed',
                'the architecture',
                'endpoints',
                'service',
              ],
            },
          ],
          grading_mode: 'experiential' as const,
          volatility: 'stable' as const,
        },
        {
          evidence_id: evConceptId,
          description: `Demonstrates conceptual clarity on performance, failure modes, or trade-offs in ${skill}`,
          tier: 'must_have' as const,
          weight: 2,
          expected_signals: [
            {
              id: `sig_${planned.type}_${index + 1}_${sIdx + 1}_concept`,
              signal: `Explains core trade-offs, concurrency, scaling, or troubleshooting in ${skill}`,
              accept_if_candidate_says: [
                'trade-off',
                'bottleneck',
                'latency',
                'concurrency',
                'error handling',
              ],
            },
          ],
          grading_mode: 'factual' as const,
          volatility: 'stable' as const,
        },
      ],
      completion_criteria: {
        required_evidence: [evImplId],
        min_confidence: 0.5,
        min_depth: 'working' as const,
      },
      exit_conditions: {
        no_new_evidence_for_turns: 2,
        max_turns: 3,
        allow_candidate_disclaim: true,
      },
      question_bank: [
        {
          bank_id: `qb_${planned.type}_${index + 1}_${sIdx + 1}_1`,
          text: `Could you walk me through how you've worked with ${skill} in your past projects, and what architectural decisions you made?`,
          targets_evidence: [evImplId],
          difficulty: 2,
          grading_mode: 'experiential' as const,
          entry_style: 'direct' as const,
        },
        {
          bank_id: `qb_${planned.type}_${index + 1}_${sIdx + 1}_2`,
          text: `When working with ${skill}, what are the common performance bottlenecks or failure modes you watch out for?`,
          targets_evidence: [evConceptId],
          difficulty: 3,
          grading_mode: 'factual' as const,
          entry_style: 'comparative' as const,
        },
      ],
    };
  });

  return {
    section_id: sectionId,
    type: planned.type as BlueprintSection['type'],
    title: planned.title,
    time_budget_sec: timeBudgetSec,
    time_ceiling_sec: timeCeilingSec,
    entry_transitions: [`Let's move on to discuss ${planned.title}.`],
    exit_transitions: [`That gives me good context on this area. Let's move to the next section.`],
    objective: planned.purpose,
    question_focus: ['resume verification', 'skill check'],
    must_verify: [planned.purpose],
    goals,
  };
}

// ── One conversational section, one model call ───────────────────────────────

async function runSection(
  input: BlueprintInput,
  planned: Strategy['sections'][number],
  index: number,
  siblings: Strategy['sections'],
  ctx: BlueprintContext,
  context?: RunContext,
): Promise<BlueprintSection> {
  const budget = SECTION_QUESTION_BUDGET[input.difficulty];

  // Only the gap entries worth investigating. The full report is 30 rows, most
  // of which this section has no business asking about, and every row of it
  // would be prompt weight on all of the parallel calls at once.
  /*
   * Grouped by gap class rather than listed flat.
   *
   * A single list sorted by investigation_priority puts every UNVERIFIED and
   * MISSING skill at the top and buries the STRONG ones, and a model reading it
   * builds the section entirely out of what the candidate cannot evidence —
   * which is the whole reason the mix quota exists. Under headings the three
   * classes are visible AS classes, and the quota below becomes something the
   * model can actually act on.
   */
  const bucket = (want: ReturnType<typeof gapClass>) =>
    input.gap.skills
      .filter((sk) => gapClass(sk.status) === want)
      .sort((a, b) => b.investigation_priority - a.investigation_priority)
      .slice(0, 6)
      .map(
        (sk) =>
          `- ${sk.skill} · ${sk.status} · importance ${sk.jd_importance.toFixed(2)} · resume: ${sk.resume_evidence} · ${sk.rationale}`,
      );

  const gapGroup = (label: string, rows: string[]) =>
    rows.length ? [label, ...rows].join('\n') : `${label}\n(none)`;

  const relevantGaps = [
    gapGroup('STRONG — the resume evidences these. Ask them to show the depth behind the claim.', bucket('strong')),
    gapGroup('WEAK — the role needs it, the resume only gestures at it. The most productive band.', bucket('weak_medium')),
    gapGroup(
      'NOT ESTABLISHED (UNVERIFIED / MISSING) — nothing corroborates these. Highest risk, highest learning.',
      bucket('not_established'),
    ),
  ].join('\n\n');

  const result = await runAgent({
    agent: 'P6',
    schema: blueprintSectionSchema,
    system: SECTION_SYSTEM,
    prompt: [
      `Interview for: ${input.roleTitle} at ${input.companyName} (${input.seniority}, ${input.difficulty} difficulty)`,
      '',
      '<this_section>',
      `type: ${planned.type}`,
      `title: ${planned.title}`,
      `minutes: ${planned.minutes}`,
      `purpose: ${planned.purpose}`,
      '</this_section>',
      '',
      // Parallel generation cannot coordinate, so each call is told what the
      // others are covering. Without this two sections independently pick the
      // most interesting gap and the candidate is asked about it twice.
      `<other_sections_in_this_interview>\n${siblings
        .filter((_, i) => i !== index)
        .map((s) => `- ${s.title} (${s.type}): ${s.purpose}`)
        .join('\n')}\nDo NOT investigate what those sections cover. Stay inside your own purpose.\n</other_sections_in_this_interview>`,
      '',
      `<candidate>\n${ctx.resume_summary}\nProjects you can name: ${ctx.candidate_projects.map((p) => `${p.name} (${p.technologies.join(', ')})`).join(' | ') || 'none listed'}\nClaims worth testing: ${ctx.claims_worth_probing.join(' | ') || 'none flagged'}\n</candidate>`,
      '',
      `<role>\n${ctx.jd_summary}\n</role>`,
      ctx.company_summary ? `<company>\n${ctx.company_summary}\n</company>` : '',
      '',
      `<gaps>\n${relevantGaps}\n</gaps>`,
      '',
      `DIFFICULTY CEILING: ${DIFFICULTY_BRIEF[input.difficulty]}`,
      '',
      `SKILL MIX: ${skillMixBrief(input.difficulty)}`,
      // The quota is an interview-wide target and this call writes ONE section,
      // so it is stated as a share to respect rather than a count to hit —
      // otherwise every section independently tries to satisfy all three
      // classes and none of them investigates anything properly.
      'That split is for the interview as a whole. Weight THIS section towards whichever classes its purpose calls for, and do not try to satisfy all three inside one section.',
      '',
      ctx.focus_skills?.length
        ? `FOCUS SKILLS — the candidate explicitly asked to be interviewed on: ${ctx.focus_skills.join(', ')}. Where one of these belongs in this section's purpose, build a goal around it and name it in question_focus. Prefer it over an equally-ranked skill; never leave this section's purpose to reach one.`
        : '',
      '',
      `PACING: this section will ask ${budget.min}-${budget.max} questions. Size its goals and evidence so there is genuinely that much to establish — a section with one thin goal leaves the interviewer circling. ${planned.type === 'behavioral' ? 'EVERY evidence item in this section must carry grading_mode "behavioral" - it is the behavioural round.' : 'At least one evidence item must carry grading_mode "factual".'}`,
      `Set section_id to "${planned.type}_${index + 1}", type to "${planned.type}", title to "${planned.title}", time_budget_sec to ${Math.round(planned.minutes * 60)} and time_ceiling_sec to ${Math.round(planned.minutes * 60 * 1.25)}.`,
      '',
      'Write this one section.',
    ]
      .filter(Boolean)
      .join('\n'),
    fallback: () => buildFallbackSection(input, planned, index, ctx),
    context,
    meta: { section: planned.type, index, difficulty: input.difficulty },
  });

  return result.data;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function runBlueprint(
  input: BlueprintInput,
  context?: RunContext,
): Promise<Blueprint> {
  const ctx = buildContext(input);
  const planned = input.strategy.sections;

  const started = Date.now();

  /*
   * Every section is dispatched at once. The code-built ones resolve
   * immediately; the model-written ones run concurrently, so the wall clock is
   * the slowest single section rather than the sum of all of them.
   */
  const jobs = planned.map(async (section, index): Promise<BlueprintSection | null> => {
    switch (section.type) {
      case 'intro':
        return warmUpSection();
      case 'closing':
        return closingSection(section);
      case 'coding':
      case 'skill_challenge':
        return moduleSection(section, index, section.type);
      default:
        return runSection(input, section, index, planned, ctx, context);
    }
  });

  const settled = await Promise.allSettled(jobs);

  const sections: BlueprintSection[] = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === 'fulfilled' && outcome.value) {
      sections.push(outcome.value);
    } else {
      const plannedSection = planned[i];
      if (plannedSection && !['intro', 'closing', 'coding', 'skill_challenge'].includes(plannedSection.type)) {
        console.warn(
          `[P6] conversational section ${plannedSection.type} (${plannedSection.title}) failed; using fallback section instead of dropping:`,
          outcome.status === 'rejected' ? outcome.reason : 'empty',
        );
        sections.push(buildFallbackSection(input, plannedSection, i, ctx));
      } else {
        console.warn(
          `[P6] section ${plannedSection?.type} (${plannedSection?.title}) failed and was dropped:`,
          outcome.status === 'rejected' ? outcome.reason : 'empty',
        );
      }
    }
  }

  const conversational = planned.filter(
    (s) => !['intro', 'closing', 'coding', 'skill_challenge'].includes(s.type),
  ).length;

  console.info(
    `[P6] ${sections.length}/${planned.length} sections in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      `(${conversational} generated in parallel, ${planned.length - conversational} built in code)`,
  );

  // The live loop needs somewhere to go after the intro. Below two sections
  // there is no interview left to run, so this fails loudly rather than
  // producing a session that ends thirty seconds after it starts.
  if (sections.length < 2) {
    throw new Error('The interview plan could not be generated. Please try again.');
  }

  return normaliseBlueprint({
    v: 2,
    blueprint_version: 2,
    estimated_duration_min: input.strategy.total_minutes,
    context: ctx,
    sections,
  });
}

/**
 * Rank used to order sections. Lower runs first.
 *
 * Coding and the skill challenge go LAST, immediately before the close. Two
 * reasons, and the first is about measurement: the conversational sections are
 * what establish the evidence the report is built from, and a coding round in
 * the middle interrupts that for ten to fifteen minutes — the candidate comes
 * back cold and the thread of what they were describing is gone. The second is
 * that a coding problem is the hardest thing in the interview, and it belongs
 * after someone has settled in, not while they are still finding their register.
 */
const SECTION_ORDER: Record<BlueprintSection['type'], number> = {
  intro: 0,
  resume_skills: 1,
  role_skills: 2,
  behavioral: 3,
  coding: 8,
  skill_challenge: 9,
  closing: 10,
};

function sectionRank(type: BlueprintSection['type']): number {
  return SECTION_ORDER[type] ?? 4;
}

/**
 * Guarantees the structural properties the live loop assumes, which the model is
 * asked for but cannot be trusted to hold perfectly across ~200 generated ids.
 *
 * Two things must be true or L3 breaks: every id is unique, and every
 * `targets_evidence` / `required_evidence` reference resolves to a real
 * evidence_id within the same goal. A dangling reference would make a goal
 * permanently unsatisfiable — it would wait forever for evidence that no
 * question can produce.
 *
 * Uniqueness matters more now than it did. Sections are generated in parallel
 * and cannot see each other's ids, so two of them independently choosing
 * `goal_1` is expected rather than exceptional — this is what catches it.
 */
export function normaliseBlueprint(bp: Blueprint): Blueprint {
  // Guarantee the warm-up opener regardless of what came back.
  if (bp.sections[0]?.type !== 'intro') {
    bp.sections = [warmUpSection(), ...bp.sections];
  }

  /*
   * Guarantee the behavioural round, and guarantee it is graded as one.
   *
   * Two failures produced the same symptom — a behavioural score of 0 on every
   * report — and both are closed here rather than asked for in a prompt:
   *
   *   the section was never planned at all, so nothing behavioural was ever
   *   asked; and
   *
   *   the section WAS planned, but its evidence came back tagged `factual` or
   *   `experiential`, and `resolveGeneratedQuestion` picks the strictest mode
   *   present — so a question in the behavioural section was graded factual and
   *   `scoreBehavioral` never ran on it.
   *
   * Invariant 9 says grading_mode is fixed at plan time and never changed
   * afterwards. This IS plan time, and the section type decides it — the same
   * argument that makes `moduleSection` build coding grading in code.
   */
  const behavioural = bp.sections.filter((s) => s.type === 'behavioral');

  if (behavioural.length === 0) {
    console.warn('[P6] no behavioural section was planned — inserting the built-in one');
    // Before the close, after everything else. `normaliseBlueprint` sorts by
    // SECTION_ORDER immediately below, so position here is not load-bearing.
    bp.sections = [...bp.sections, behaviouralSection(4)];
  } else {
    for (const section of behavioural) {
      for (const goal of section.goals) {
        for (const ev of goal.evidence_required) ev.grading_mode = 'behavioral';
        for (const q of goal.question_bank) q.grading_mode = 'behavioral';
      }
    }
  }

  /*
   * Stable sort by rank: sections of the same type keep the order the strategy
   * chose, which is the order it reasoned about. Only the module and closing
   * blocks actually move.
   */
  bp.sections = bp.sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => sectionRank(a.section.type) - sectionRank(b.section.type) || a.index - b.index)
    .map((entry) => entry.section);

  const seen = new Set<string>();
  const unique = (candidate: string, prefix: string) => {
    let id = candidate?.trim() || `${prefix}_1`;
    let n = 2;
    while (seen.has(id)) id = `${candidate}_${n++}`;
    seen.add(id);
    return id;
  };

  bp.sections = bp.sections.map((section, si) => {
    section.section_id = unique(section.section_id, `sec_${si + 1}`);

    section.goals = section.goals.map((goal, gi) => {
      goal.goal_id = unique(goal.goal_id, `goal_${si + 1}_${gi + 1}`);

      /*
       * ── Floors on the exit conditions ─────────────────────────────────────
       *
       * P6 routinely writes `no_new_evidence_for_turns: 1`, which reads
       * reasonable and behaves terribly: the first answer to a goal cannot
       * produce "new" evidence relative to a turn that has not happened yet, so
       * the goal exits on diminishing returns before it has been probed once.
       * Every section then got exactly one question.
       *
       * A goal must survive its opening answer and get at least one follow-up.
       * The intro is exempt — it is meant to close after one answer.
       */
      if (section.type !== 'intro') {
        goal.exit_conditions.no_new_evidence_for_turns = Math.max(
          2,
          goal.exit_conditions.no_new_evidence_for_turns,
        );
        goal.exit_conditions.max_turns = Math.max(3, goal.exit_conditions.max_turns);
      }

      const evidenceIds = new Set<string>();
      goal.evidence_required = goal.evidence_required.map((ev, ei) => {
        ev.evidence_id = unique(ev.evidence_id, `ev_${si + 1}_${gi + 1}_${ei + 1}`);
        evidenceIds.add(ev.evidence_id);
        // Signal ids are the join key E4's observations come back on, so a
        // duplicate silently credits one signal for another's coverage.
        ev.expected_signals = ev.expected_signals.map((s, sIdx) => ({
          ...s,
          id: unique(s.id, `sig_${si + 1}_${gi + 1}_${ei + 1}_${sIdx + 1}`),
        }));
        return ev;
      });

      const resolve = (ids: string[]) => {
        const kept = ids.filter((id) => evidenceIds.has(id));
        // Never leave an empty target list — a question that targets nothing can
        // never close its goal. Fall back to every evidence item in the goal.
        return kept.length > 0 ? kept : [...evidenceIds];
      };

      goal.completion_criteria.required_evidence = resolve(
        goal.completion_criteria.required_evidence,
      );

      goal.question_bank = goal.question_bank.map((q, qi) => {
        q.bank_id = unique(q.bank_id, `qb_${si + 1}_${gi + 1}_${qi + 1}`);
        q.targets_evidence = resolve(q.targets_evidence);
        return q;
      });

      return goal;
    });

    return section;
  });

  rescaleSectionTime(bp);
  reportQuestionMix(bp);
  return bp;
}

/**
 * Makes the per-section estimates add up to the interview actually being run.
 *
 * The live loop now paces itself against `time_budget_sec` — under budget it
 * digs deeper, at budget it moves on — so these numbers stopped being
 * decoration the moment that landed. They can drift from the real length two
 * ways: a section the strategy planned may have failed and been dropped, and
 * the behavioural round above may have been inserted without the strategy ever
 * budgeting for it.
 *
 * So they are rescaled to `estimated_duration_min`, keeping each section's
 * SHARE of the interview — which is the thing P5 actually reasoned about — and
 * holding a 45-second floor so a squeezed section is short rather than
 * impossible.
 */
function rescaleSectionTime(bp: Blueprint): void {
  const targetSec = Math.round(bp.estimated_duration_min * 60);
  const plannedSec = bp.sections.reduce((sum, s) => sum + s.time_budget_sec, 0);
  if (targetSec <= 0 || plannedSec <= 0) return;

  const factor = targetSec / plannedSec;
  // Within a couple of percent it is already right, and rescaling would only
  // introduce rounding noise into numbers a human reads on the report.
  if (Math.abs(factor - 1) < 0.02) return;

  for (const section of bp.sections) {
    section.time_budget_sec = Math.max(45, Math.round(section.time_budget_sec * factor));
    section.time_ceiling_sec = Math.max(
      section.time_budget_sec + 30,
      Math.round(section.time_budget_sec * 1.25),
    );
  }

  console.info(
    `[P6] section time rescaled x${factor.toFixed(2)} to fit ${bp.estimated_duration_min} min ` +
      `(${bp.sections.map((s) => `${s.type}:${Math.round(s.time_budget_sec / 60)}m`).join(' ')})`,
  );
}

/**
 * Logs any non-intro section with no skill check in it.
 *
 * Not a repair: a factual question is worthless without a rubric written for it,
 * and synthesizing one in code would produce a question the grader cannot mark.
 * The prompt asks for these firmly; this is how you find out when it did not
 * comply, rather than discovering it from a report full of resume questions.
 */
function reportQuestionMix(bp: Blueprint): void {
  const thin = bp.sections
    // The two module sections are exempt: their content is a challenge P7 wrote,
    // not a bank of spoken questions.
    .filter(
      (s) =>
        s.type !== 'intro' &&
        s.type !== 'closing' &&
        s.type !== 'coding' &&
        s.type !== 'skill_challenge' &&
        // Behavioural evidence is behavioural by contract; a factual item in
        // here would be the bug, not the fix.
        s.type !== 'behavioral',
    )
    .filter((s) => s.goals.every((g) => g.question_bank.every((q) => q.grading_mode !== 'factual')))
    .map((s) => s.section_id);

  if (thin.length > 0) {
    console.warn('[P6] sections with no skill-check question:', thin.join(', '));
  }
}
