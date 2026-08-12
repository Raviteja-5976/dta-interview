/**
 * Rule-layer harness for R12 (section question budget) and R13 (question mix).
 *
 * Run with:  npx tsx scripts/dev/budget-check.ts
 *
 * Not part of the build or the test suite — there isn't one — but these two
 * rules are the only thing guaranteeing that a section ends and that the
 * interview terminates, so they are worth being able to check without running a
 * real interview. It has already earned its keep once: it caught that
 * TRANSITION_SECTION was being dropped by the top-8 shortlist slice, which made
 * every section run to its exact ceiling instead of ending anywhere in its band.
 *
 * Expected shape:
 *   below the floor   leave=n stay=Y   (must keep asking)
 *   inside the band   leave=Y stay=Y   (L1's judgement)
 *   at the ceiling    leave=Y stay=n   (must move on)
 */

import { legalActions } from '../../lib/engine/rules';
import { initialRuntime, SECTION_QUESTION_BUDGET } from '../../lib/engine/types';
import type { Blueprint } from '../../lib/agents/schemas';

const goal = (id: string) => ({
  goal_id: id,
  priority: 0.5,
  skill_tags: ['python'],
  statement: 'establish something',
  evidence_required: [
    { evidence_id: `${id}_e1`, description: 'd', tier: 'must_have' as const, weight: 1 },
  ],
  completion_criteria: {
    required_evidence: [`${id}_e1`],
    min_confidence: 0.5,
    min_depth: 'working' as const,
  },
  exit_conditions: { no_new_evidence_for_turns: 2, max_turns: 3, allow_candidate_disclaim: true },
  question_bank: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    bank_id: `${id}_q${n}`,
    text: `question ${n} for ${id}`,
    targets_evidence: [`${id}_e1`],
    difficulty: 2,
    grading_mode: (n % 2 ? 'factual' : 'experiential') as 'factual' | 'experiential',
    entry_style: 'direct' as const,
    rubric: {
      expected_signals: [],
      common_misconceptions: [],
      volatility: 'stable' as const,
      max_followups: 1,
    },
  })),
  followup_bank: [],
});

const blueprint = {
  sections: [
    {
      section_id: 'sec_1',
      type: 'resume_skills',
      title: 'A',
      time_budget_sec: 300,
      time_ceiling_sec: 375,
      entry_transitions: ['in'],
      exit_transitions: ['out'],
      goals: [goal('g1'), goal('g2')],
    },
    {
      section_id: 'sec_2',
      type: 'closing',
      title: 'B',
      time_budget_sec: 120,
      time_ceiling_sec: 150,
      entry_transitions: ['in'],
      exit_transitions: ['out'],
      goals: [goal('g3')],
    },
  ],
} as unknown as Blueprint;

const coverage = {
  session_id: 's',
  updated_at_turn: 0,
  goals: ['g1', 'g2'].map((id) => ({
    goal_id: id,
    section_id: 'sec_1',
    status: 'in_progress' as const,
    turns_spent: 1,
    confidence: 0.2,
    depth_reached: 'surface' as const,
    evidence: [
      { evidence_id: `${id}_e1`, status: 'missing' as const, confidence: 0, source_question_ids: [] },
    ],
    outstanding: [`${id}_e1`],
    turns_without_new_evidence: 1,
  })),
  by_skill: [],
  section_status: [],
};

let failures = 0;
const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = actual === wanted;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} — got ${actual}, wanted ${wanted}`);
};

// ── R12 · the budget band ────────────────────────────────────────────────────
for (const difficulty of ['easy', 'medium', 'hard'] as const) {
  const b = SECTION_QUESTION_BUDGET[difficulty];
  console.log(`\nR12 ${difficulty} (${b.min}-${b.max}):`);

  for (let asked = 0; asked <= b.max; asked += 1) {
    const runtime = { ...initialRuntime('sec_1', 2), questions_in_section: asked, turn: asked + 1 };
    const actions = legalActions({
      blueprint,
      coverage,
      runtime,
      memory: [],
      difficulty,
      sectionElapsedSec: 60,
    });

    const canLeave = actions.some((a) => a.action === 'TRANSITION_SECTION');
    const canStay = actions.some((a) => a.action !== 'TRANSITION_SECTION');

    expect(`asked=${asked} canLeave`, canLeave, asked >= b.min);
    expect(`asked=${asked} canStay`, canStay, asked < b.max);
  }
}

// ── The section time ceiling overrides the question count ────────────────────
console.log('\nR12 time ceiling:');
{
  const runtime = { ...initialRuntime('sec_1', 2), questions_in_section: 1 };
  const actions = legalActions({
    blueprint,
    coverage,
    runtime,
    memory: [],
    difficulty: 'hard',
    sectionElapsedSec: 400, // past time_ceiling_sec of 375
  });
  expect('only transition remains', actions.every((a) => a.action === 'TRANSITION_SECTION'), true);
}

// ── R13 · two of a kind in a row promotes the other kind ─────────────────────
console.log('\nR13 question mix:');
{
  const runtime = {
    ...initialRuntime('sec_1', 2),
    questions_in_section: 2,
    recent_grading_modes: ['factual', 'factual'] as Array<'factual' | 'experiential'>,
  };
  const actions = legalActions({
    blueprint,
    coverage,
    runtime,
    memory: [],
    difficulty: 'hard',
    sectionElapsedSec: 60,
  });

  const top = actions.find((a) => a.grading_mode);
  expect('top graded option is not the overused mode', top?.grading_mode, 'experiential');
}

console.log(failures === 0 ? '\nAll rule checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
