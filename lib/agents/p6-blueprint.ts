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

- 2-4 questions per goal, each a genuinely DIFFERENT way in — not rewordings. Vary entry_style: direct asks plainly, story asks for a specific incident, hypothetical poses a situation, comparative asks them to choose between two options and justify it.
- targets_evidence links each question to what it is trying to surface. Be accurate; the interviewer selects by gap.
- Questions must be speakable. This is voice — a candidate hears it once. One question per question. No multi-part questions, no parentheticals, nothing over about 30 words.
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

Follow the strategy's sections, titles and minute allocations exactly. time_budget_sec is the target; time_ceiling_sec is roughly 25% higher. The first section is a short intro with one warm-up goal, the last is a short closing.`;

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
function normaliseBlueprint(bp: Blueprint): Blueprint {
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

  return bp;
}
