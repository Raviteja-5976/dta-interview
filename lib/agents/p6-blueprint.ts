/**
 * P6 · Interview Blueprint Agent
 *
 * The most important agent in the system, and the only one on the `deep` tier.
 *
 * It converts the strategy into GOALS — evidence requirements, completion
 * criteria, exit conditions, question banks, follow-up banks — plus the grading
 * rubric for every bank entry. One call per session; its output drives all ~25
 * live turns and the whole evaluation phase.
 *
 * Design decision D1: this emits goals, not a script. Nothing in the output
 * implies an order. `question_bank` is an unordered pool that L1 selects from by
 * evidence gap.
 *
 * Invariants enforced by the prompt below:
 *   #4 — P6 never emits an emotion tag. Delivery is L4's alone.
 *   #6 — Rubrics are generated before the interview, never after.
 *   #9 — grading_mode is assigned here and never changes.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { SECTION_QUESTION_BUDGET } from '../engine/types';
import {
  blueprintSchema,
  type Blueprint,
  type CompanyProfile,
  type GapReport,
  type ResumeProfile,
  type Strategy,
} from './schemas';

const SYSTEM = `You design the plan for a voice mock interview. You are not writing a script. You are writing the set of things the interviewer needs to find out, and giving them several ways in.

## Goals, not questions

A goal is a destination. A question is a route. You provide destinations and a pool of routes; the live interviewer picks the route based on what the candidate actually says.

Every goal needs:
- statement: what this goal must ESTABLISH, phrased as a finding, not a topic.
    good: "Establish whether the Kubernetes claim is hands-on implementation or observational exposure."
    bad:  "Ask about Kubernetes."
- evidence_required: 2-4 specific, observable things a candidate would say if the claim were true. These are the join key for the entire system — the live evidence tracker matches answers against them, and the report's coverage rows come from them. Write them as observable behaviours ("Names the specific workload deployed"), never as qualities ("Shows good understanding").
- completion_criteria.required_evidence: only the must_have items. A goal is done when the core is established, not when every bonus is collected.
- exit_conditions: when to give up. Always set these — a goal with no exit is a goal that eats the interview.

## Question banks

- 3-5 questions per goal, each a genuinely DIFFERENT way in — not rewordings. Vary entry_style: direct asks plainly, story asks for a specific incident, hypothetical poses a situation, comparative asks them to choose between two options and justify it.

### Every section needs all three KINDS of question

A bank made only of "tell me about your project" questions cannot distinguish someone who built the thing from someone who watched it being built. Each non-intro section's questions, taken together, must cover:

1. RESUME VERIFICATION — anchored to something they actually claim. "Your resume says you cut p99 latency by 40% on the checkout service — what was the bottleneck?" grading_mode: experiential.

2. SKILL CHECK — a direct test of the concept itself, with NO reference to their work. This is the kind most often missing, so write at least ONE per section and give it grading_mode "factual". It is answerable by someone who understands the topic and not by someone who has only used a library that does it:
     "What is RAG? Walk me through what happens between a user's question and the answer."
     "What is a transformer model, and why did attention replace recurrence?"
     "In Python, when would you reach for a generator instead of a list?"
     "What does an index actually cost you on writes?"
   Pitch it at the seniority given. These are not trivia — never ask for a definition that could be recited; ask for the mechanism, or when you would and would not use it.

3. APPLIED JUDGEMENT — a hypothetical or comparative that makes them choose and defend. "Your retrieval returns the right document but the answer still cites the wrong section — where do you look first?" grading_mode: factual.

Note that 2 and 3 are the questions a candidate cannot prepare for by rehearsing their own resume, which is most of what makes an interview informative.
- targets_evidence links each question to what it is trying to surface. Be accurate; the interviewer selects by gap.
- Questions must be speakable. This is voice — a candidate hears it once. One question per question. No multi-part questions, no parentheticals, nothing over about 30 words.

### Every question carries its own frame

The interviewer moves between topics, and a question may be asked immediately after an unrelated one. A question that assumes the previous question is still in the air will be answered at the wrong scope, and the answer will then be graded as if the candidate had misunderstood — when in fact they were never told what was being asked about.

So each question names its own subject:
  "In your resume you list Hyrzo — how did you implement retrieval in it?"     ← the candidate knows this is about their project
  "How did you implement RAG?"                                                  ← ambiguous; they may explain RAG in general
  "Setting your own work aside for a second — what is a transformer model?"     ← explicitly signals a general question
  "What is a transformer model?"                                                ← after a resume question, they may answer about their project

The frame is a short lead-in, not an extra sentence: name the project, the claim, or the fact that this one is general. It costs four words and it is the difference between grading an answer and grading a misunderstanding.
- followup_bank entries are the probes for when an answer lands on the topic but misses the evidence. use_when describes the observable condition ("ownership_ambiguous", "problem_named_without_diagnosis").

## grading_mode — assign carefully, it is permanent

- factual: there is a correct answer. "What does a database index cost you on write?"
- experiential: about their own work. Scored on depth and specificity, NEVER marked wrong. Anything referencing their resume is experiential.
- behavioral: about how they worked with people. Scored on STAR structure.
- coding: solved in the editor.
Getting this wrong means an answer about someone's own project gets graded against a factual rubric, which is both incorrect and unfair.

## Rubrics

Every bank question carries a rubric, written NOW, before the interview:
- expected_signals: what a good answer contains, each tied to an evidence_id, each with a tier and weight (must_have 3, good_to_have 2, bonus 1).
- accept_if_candidate_says: literal phrases or close variants that should count as covering the signal. The live tracker matches against these, so give real spoken phrasings, not formal terminology.
- volatility: "stable" for fundamentals that have not changed in a decade, "versioned" for anything tied to a specific release, "volatile" for actively-moving topics. Stable rubrics never trigger a web lookup later, which is a large part of what keeps this affordable — so do not mark something versioned unless it truly is.

## Transitions

entry_transitions and exit_transitions are how the interviewer enters and leaves each section. Write them plainly and conversationally. They must contain NO emotional direction, no stage instructions, and no bracketed tags. How something is delivered is decided elsewhere; you only supply words.

## Sections

Follow the strategy's sections, titles and minute allocations exactly. time_budget_sec is the target; time_ceiling_sec is roughly 25% higher.

## The opening section is a warm-up, and this is not negotiable

The first section has type "intro", exactly one goal, and that goal exists to get the candidate talking comfortably. It does NOT investigate a skill.

Its questions are open, personal, and impossible to get wrong:
  "Tell me a bit about yourself and what you've been working on lately."
  "What's a project from your recent work you enjoyed most?"
  "Before we get into specifics — how did you end up in this field?"

They are NOT:
  "What's your experience with Kubernetes?"          ← that is an investigation
  "Walk me through your most complex system design."  ← that is the hard part
  Anything naming a technology, a trade-off, or a metric.

grading_mode for every intro question is "experiential" — an answer about themselves cannot be wrong. Keep its evidence_required soft and easily satisfiable ("names what they currently work on", "gives some context on their background"), so the goal closes quickly and the interview moves on.

Two reasons this matters. It is basic courtesy — nobody starts a conversation with an interrogation. And it protects the measurement: a candidate rattled by a hard opening question performs worse for the remaining twenty minutes, which corrupts every score taken after it.`;

export interface BlueprintInput {
  strategy: Strategy;
  gap: GapReport;
  resume: ResumeProfile;
  company?: CompanyProfile | null;
  roleTitle: string;
  companyName: string;
  seniority: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export async function runBlueprint(
  input: BlueprintInput,
  context?: RunContext,
): Promise<Blueprint> {
  // Only what P6 needs. The full resume would bloat a `deep`-tier prompt for no
  // gain — the parts that matter are the probe-worthy claims and the projects
  // that questions can be anchored to.
  const resumeDigest = {
    headline: input.resume.headline,
    years_experience: input.resume.years_experience,
    projects: input.resume.projects,
    claims_worth_probing: input.resume.claims_worth_probing,
    top_skills: input.resume.skills.slice(0, 20),
  };

  const budget = SECTION_QUESTION_BUDGET[input.difficulty];

  const companyBlock = input.company
    ? `<company>\nStack: ${input.company.tech_stack.map((t) => t.technology).join(', ')}\nEmphasis: ${input.company.interview_emphasis.join(' | ')}\n</company>`
    : '<company>(no company research — do not reference the company specifically)</company>';

  const result = await runAgent({
    agent: 'P6',
    schema: blueprintSchema,
    system: SYSTEM,
    prompt: [
      `Interview for: ${input.roleTitle} at ${input.companyName} (${input.seniority}, ${input.difficulty} difficulty)`,
      `<strategy>\n${JSON.stringify(input.strategy)}\n</strategy>`,
      `<gap_report>\n${JSON.stringify(input.gap)}\n</gap_report>`,
      `<resume>\n${JSON.stringify(resumeDigest)}\n</resume>`,
      companyBlock,
      // The live loop enforces this budget whatever P6 writes, so it has to know
      // it: a section allowed six questions whose goals only carry three between
      // them runs out of material and starts repeating itself.
      `PACING: at ${input.difficulty} difficulty each section will ask ${budget.min}-${budget.max} questions. ` +
        `Give every non-intro section enough distinct bank questions across its goals to sustain ${budget.max} without repeating, ` +
        `including at least one skill check with grading_mode "factual".`,
      `Build the blueprint. One section per strategy section, in the same order, with the same titles and minute budgets.`,
    ].join('\n\n'),
    context,
    meta: {
      sections: input.strategy.sections.length,
      duration_min: input.strategy.total_minutes,
      difficulty: input.difficulty,
    },
  });

  return normaliseBlueprint(result.data);
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
 */
/**
 * A warm-up section, built in code.
 *
 * Used only when P6 did not open with one. The prompt asks for it firmly, but
 * "the first thing the candidate hears" is too important to leave to
 * instruction-following: a hard technical question in the opening thirty
 * seconds rattles people, and every measurement taken afterwards is degraded by
 * it. Cheap to guarantee, expensive to get wrong.
 *
 * Deliberately generic. It cannot reference the resume or the role, because it
 * exists precisely for the case where the model did not produce something
 * tailored — and a safe opener beats a clever one.
 */
function warmUpSection(): Blueprint['sections'][number] {
  return {
    section_id: 'sec_intro',
    type: 'intro',
    title: 'Getting started',
    time_budget_sec: 75,
    time_ceiling_sec: 120,
    entry_transitions: ["Thanks for making the time — let's start easy."],
    exit_transitions: ["That's a good place to start. Let's get into the role itself."],
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
          },
          {
            evidence_id: 'ev_intro_context',
            description: 'Gives some background on how they got there',
            tier: 'good_to_have',
            weight: 1,
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
            // An answer about themselves cannot be marked wrong.
            grading_mode: 'experiential',
            entry_style: 'direct',
            rubric: {
              expected_signals: [
                {
                  id: 'sig_intro_1',
                  evidence_id: 'ev_intro_current',
                  signal: 'Names what they currently work on',
                  tier: 'must_have',
                  weight: 1,
                  accept_if_candidate_says: ['I work', "I'm working", 'currently', 'my role', 'I build'],
                },
              ],
              common_misconceptions: [],
              volatility: 'stable',
              max_followups: 1,
            },
          },
        ],
        followup_bank: [],
      },
    ],
  };
}

/**
 * Rank used to order sections. Lower runs first.
 *
 * Coding and system design go LAST, immediately before the close. Two reasons,
 * and the first is about measurement: the conversational sections are what
 * establish the evidence the report is built from, and a coding round in the
 * middle interrupts that for ten to fifteen minutes — the candidate comes back
 * cold and the thread of what they were describing is gone. The second is that
 * a coding problem is the hardest thing in the interview, and it belongs after
 * someone has settled in, not while they are still finding their register.
 */
const SECTION_ORDER: Record<Blueprint['sections'][number]['type'], number> = {
  intro: 0,
  resume_skills: 1,
  role_skills: 2,
  behavioral: 3,
  coding: 8,
  system_design: 9,
  closing: 10,
};

function sectionRank(type: Blueprint['sections'][number]['type']): number {
  return SECTION_ORDER[type] ?? 4;
}

export function normaliseBlueprint(bp: Blueprint): Blueprint {
  // Guarantee the warm-up opener regardless of what the model returned.
  if (bp.sections[0]?.type !== 'intro') {
    bp.sections = [warmUpSection(), ...bp.sections];
  }

  /*
   * Stable sort by rank: sections of the same type keep the order P6 chose,
   * which is the order it reasoned about. Only the coding and closing blocks
   * actually move.
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
       * The intro is exempt — it is meant to close after one answer, and its
       * whole job is to let someone settle in.
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
        q.rubric.expected_signals = q.rubric.expected_signals.map((s, sIdx) => ({
          ...s,
          id: unique(s.id, `sig_${qi + 1}_${sIdx + 1}`),
          evidence_id: evidenceIds.has(s.evidence_id)
            ? s.evidence_id
            : q.targets_evidence[0],
        }));
        return q;
      });

      goal.followup_bank = goal.followup_bank
        .map((f, fi) => ({
          ...f,
          followup_id: unique(f.followup_id, `fu_${si + 1}_${gi + 1}_${fi + 1}`),
        }))
        // A follow-up for evidence that does not exist can never be selected.
        .filter((f) => evidenceIds.has(f.for_evidence));

      return goal;
    });

    return section;
  });

  reportQuestionMix(bp);
  return bp;
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
    .filter((s) => s.type !== 'intro' && s.type !== 'closing' && s.type !== 'coding')
    .filter((s) =>
      s.goals.every((g) => g.question_bank.every((q) => q.grading_mode !== 'factual')),
    )
    .map((s) => s.section_id);

  if (thin.length > 0) {
    console.warn('[P6] sections with no skill-check question:', thin.join(', '));
  }

  const shallow = bp.sections
    .filter((s) => s.type !== 'intro' && s.type !== 'closing')
    .filter((s) => s.goals.reduce((n, g) => n + g.question_bank.length, 0) < 4)
    .map((s) => s.section_id);

  if (shallow.length > 0) {
    console.warn('[P6] sections with too few bank questions to fill their budget:', shallow.join(', '));
  }
}
