/**
 * Zod contracts for every agent output.
 *
 * These are the objects in reference/agentdesign.md §3, expressed as schemas so
 * that the model is constrained at generation time and the result is validated
 * before it ever reaches the database.
 *
 * ── Portability rule ─────────────────────────────────────────────────────────
 * Deliberately avoided throughout: `z.union`, `z.record`, `z.any`, and nesting
 * deeper than about four levels. Gemini's structured-output mode rejects unions
 * and records outright, and deep schemas degrade on every provider. Enums and
 * flat fields say the same thing and survive a provider switch, which is the
 * entire point of the abstraction underneath.
 *
 * ── Why there is no `.optional()` or `.default()` in this file ───────────────
 * OpenAI's strict structured-output mode requires every property to appear in
 * the schema's `required` array. Both `.optional()` and `.default()` emit a
 * property that is absent from `required`, and the API rejects the whole request:
 *
 *   Invalid schema for response_format: 'required' is required to be supplied
 *   and to be an array including every key in properties.
 *
 * The documented way to express "this may have no value" is a null union, so
 * every such field is `.nullable()` and every consumer handles null. Read a
 * `null` here as "the model had nothing to put here", which is exactly what an
 * absent key would have meant.
 *
 * Every artifact carries `v` — db-design.md §11 calls for a version key on each
 * JSONB object so readers can branch on shape instead of running a migration.
 * It is a required literal rather than a default for the same reason; strict
 * mode guarantees the model emits exactly `2`.
 */

import { z } from 'zod';

const score10 = z.number().min(0).max(10);
const confidence = z.number().min(0).max(1);

// ── P1 · Company Research ────────────────────────────────────────────────────

export const companyProfileSchema = z.object({
  v: z.literal(2),
  one_liner: z.string().describe('What the company does, in one sentence.'),
  industry: z.string(),
  size_estimate: z.string().describe('e.g. "500-1000 employees" or "unknown".'),
  products: z.array(z.string()).max(8),
  tech_stack: z
    .array(
      z.object({
        technology: z.string(),
        area: z.enum(['frontend', 'backend', 'data', 'infra', 'mobile', 'ml', 'other']),
        confidence,
        source: z.string().describe('URL or page title this was inferred from.'),
      }),
    )
    .max(25),
  engineering_culture: z
    .array(z.object({ signal: z.string(), source: z.string() }))
    .max(8),
  values: z.array(z.string()).max(8),
  recent_news: z
    .array(z.object({ headline: z.string(), relevance: z.string() }))
    .max(5),
  interview_emphasis: z
    .array(z.string())
    .max(6)
    .describe('What this company would probe hardest, given the above.'),
  overall_confidence: confidence,
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

// ── P2 · Resume Parser ───────────────────────────────────────────────────────

export const resumeProfileSchema = z.object({
  v: z.literal(2),
  full_name: z.string().nullable(),
  headline: z.string().nullable(),
  years_experience: z.number().min(0).max(60).nullable(),
  skills: z.array(
    z.object({
      skill: z.string(),
      // Evidence strength is what P4 joins on — a skill in a bullet list is not
      // the same claim as a skill with a shipped project behind it.
      evidence: z.enum(['listed_only', 'mentioned_in_project', 'quantified_outcome']),
      years: z.number().min(0).max(60).nullable(),
    }),
  ).max(40),
  projects: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      technologies: z.array(z.string()).max(12),
      role: z.string().nullable(),
      impact: z.string().nullable(),
    }),
  ).max(12),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      duration: z.string().nullable(),
      highlights: z.array(z.string()).max(6),
    }),
  ).max(10),
  education: z.array(z.object({ institution: z.string(), qualification: z.string() })).max(5),
  /**
   * The reason P2 is not a regex. agentdesign.md §6: emphasis on claims worth
   * probing, not a flat skill list.
   */
  claims_worth_probing: z.array(
    z.object({
      claim: z.string().describe('Quoted or closely paraphrased from the resume.'),
      why: z.string().describe('What makes it unverified or surprising.'),
      related_skills: z.array(z.string()).max(6),
      probe_value: confidence.describe('How much an interview would learn by testing it.'),
    }),
  ).max(12),
});
export type ResumeProfile = z.infer<typeof resumeProfileSchema>;

export const atsSchema = z.object({
  v: z.literal(2),
  score: z.number().min(0).max(100),
  keyword_coverage: confidence,
  missing_keywords: z.array(z.string()).max(20),
  formatting: z.object({
    score: z.number().min(0).max(100),
    issues: z.array(z.string()).max(10),
  }),
  sections: z.object({
    experience: z.number().min(0).max(100),
    projects: z.number().min(0).max(100),
    achievements: z.number().min(0).max(100),
    formatting: z.number().min(0).max(100),
  }),
});
export type AtsReport = z.infer<typeof atsSchema>;

// ── P3 · JD Parser ───────────────────────────────────────────────────────────

export const jdProfileSchema = z.object({
  v: z.literal(2),
  role_title: z.string(),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'unknown']),
  required_skills: z.array(
    z.object({
      skill: z.string(),
      importance: confidence,
      derived_from: z.string().describe('The phrase in the posting this came from.'),
    }),
  ).max(25),
  preferred_skills: z.array(z.object({ skill: z.string(), importance: confidence })).max(15),
  responsibilities: z.array(z.string()).max(12),
  implicit_expectations: z.array(
    z.object({
      expectation: z.string(),
      derived_from: z.string(),
    }),
  ).max(8),
  soft_skills: z.array(z.string()).max(8),
  domain_knowledge: z.array(z.string()).max(8),
});
export type JdProfile = z.infer<typeof jdProfileSchema>;

// ── P4 · Gap Analysis ────────────────────────────────────────────────────────

export const skillStatus = z.enum(['STRONG', 'WEAK', 'UNVERIFIED', 'MISSING', 'SURPLUS']);
export const depthLevel = z.enum(['surface', 'working', 'implementation', 'design']);

export const gapReportSchema = z.object({
  v: z.literal(2),
  skills: z.array(
    z.object({
      skill: z.string(),
      status: skillStatus,
      jd_importance: confidence,
      resume_evidence: z.enum(['none', 'listed_only', 'mentioned_in_project', 'quantified_outcome']),
      rationale: z.string(),
      investigation_priority: confidence,
    }),
  ).max(30),
  summary: z.string().describe('Two or three sentences on where this candidate stands.'),
  top_investigations: z
    .array(z.string())
    .max(8)
    .describe('Ranked list of what the interview must find out.'),
});
export type GapReport = z.infer<typeof gapReportSchema>;

// ── P5 · Interview Strategy ──────────────────────────────────────────────────

export const strategySchema = z.object({
  v: z.literal(2),
  total_minutes: z.number().min(5).max(90),
  sections: z.array(
    z.object({
      type: z.enum([
        'intro',
        'resume_skills',
        'role_skills',
        'behavioral',
        'coding',
        'system_design',
        'closing',
      ]),
      title: z.string(),
      minutes: z.number().min(1).max(45),
      purpose: z.string(),
    }),
  ).max(8),
  priority_skills: z.array(z.string()).max(10),
  difficulty_curve: z.object({
    start_level: z.number().int().min(1).max(5),
    max_level: z.number().int().min(1).max(5),
    ramp: z.enum(['flat', 'gentle', 'steep']),
  }),
  evidence_depth_target: depthLevel,
  stop_rules: z.array(z.string()).max(6),
});
export type Strategy = z.infer<typeof strategySchema>;

// ── P6 · Blueprint (agentdesign.md §3.2) ─────────────────────────────────────

export const gradingMode = z.enum(['factual', 'experiential', 'behavioral', 'coding']);

export const rubricSchema = z.object({
  expected_signals: z.array(
    z.object({
      id: z.string(),
      evidence_id: z.string(),
      signal: z.string(),
      tier: z.enum(['must_have', 'good_to_have', 'bonus']),
      weight: z.number().int().min(1).max(3),
      accept_if_candidate_says: z.array(z.string()).max(8),
    }),
  ).max(8),
  common_misconceptions: z.array(z.string()).max(5),
  volatility: z.enum(['stable', 'versioned', 'volatile']),
  max_followups: z.number().int().min(0).max(5),
});

export const blueprintSchema = z.object({
  v: z.literal(2),
  blueprint_version: z.literal(2),
  estimated_duration_min: z.number().min(5).max(90),
  sections: z.array(
    z.object({
      section_id: z.string(),
      type: z.enum([
        'intro',
        'resume_skills',
        'role_skills',
        'behavioral',
        'coding',
        'system_design',
        'closing',
      ]),
      title: z.string(),
      time_budget_sec: z.number().int().min(60).max(2700),
      time_ceiling_sec: z.number().int().min(60).max(3600),
      entry_transitions: z.array(z.string()).min(1).max(3),
      exit_transitions: z.array(z.string()).min(1).max(3),
      goals: z.array(
        z.object({
          goal_id: z.string(),
          priority: confidence,
          skill_tags: z.array(z.string()).max(5),
          statement: z.string().describe('What this goal must establish.'),
          evidence_required: z.array(
            z.object({
              evidence_id: z.string(),
              description: z.string(),
              tier: z.enum(['must_have', 'good_to_have', 'bonus']),
              weight: z.number().int().min(1).max(3),
            }),
          ).min(1).max(6),
          completion_criteria: z.object({
            required_evidence: z.array(z.string()).min(1).max(4),
            min_confidence: confidence,
            min_depth: depthLevel,
          }),
          // `time_ceiling` max_turns and `diminishing_returns` are always present;
          // L3 evaluates them deterministically, so they are plain numbers here
          // rather than the typed-union the prose describes.
          exit_conditions: z.object({
            no_new_evidence_for_turns: z.number().int().min(1).max(4),
            max_turns: z.number().int().min(1).max(8),
            allow_candidate_disclaim: z.boolean(),
          }),
          question_bank: z.array(
            z.object({
              bank_id: z.string(),
              text: z.string(),
              targets_evidence: z.array(z.string()).min(1).max(4),
              difficulty: z.number().int().min(1).max(5),
              grading_mode: gradingMode,
              entry_style: z.enum(['direct', 'story', 'hypothetical', 'comparative']),
              rubric: rubricSchema,
            }),
          ).min(1).max(6),
          followup_bank: z.array(
            z.object({
              followup_id: z.string(),
              for_evidence: z.string(),
              text: z.string(),
              use_when: z.string(),
            }),
          ).max(8),
        }),
      ).min(1).max(4),
    }),
  ).min(2).max(7),
});
export type Blueprint = z.infer<typeof blueprintSchema>;

// ── P7 · Coding & design challenges ──────────────────────────────────────────

export const codingChallengeSchema = z.object({
  v: z.literal(2),
  title: z.string(),
  problem_statement: z.string(),
  input_format: z.string(),
  output_format: z.string(),
  examples: z.array(z.object({ input: z.string(), output: z.string(), explanation: z.string() })).min(1).max(3),
  starter_code: z.array(z.object({ language: z.string(), code: z.string() })).min(1).max(4),
  visible_tests: z.array(z.object({ input: z.string(), expected: z.string() })).min(1).max(5),
  hidden_tests: z.array(z.object({ input: z.string(), expected: z.string() })).min(1).max(8),
  target_complexity: z.object({ time: z.string(), space: z.string() }),
  hints: z.array(z.string()).max(3).describe('Escalating — least revealing first.'),
  reference_solution: z.object({ language: z.string(), code: z.string(), commentary: z.string() }),
  skill_tags: z.array(z.string()).max(6),
});
export type CodingChallenge = z.infer<typeof codingChallengeSchema>;

export const designChallengeSchema = z.object({
  v: z.literal(2),
  title: z.string(),
  scenario: z.string(),
  constraints: z.array(z.string()).max(8),
  scale_targets: z.array(z.string()).max(6),
  expected_components: z.array(
    z.object({ component: z.string(), why: z.string(), tier: z.enum(['must_have', 'good_to_have', 'bonus']) }),
  ).max(12),
  discussion_probes: z.array(z.string()).max(6),
  reference_design: z.string(),
});
export type DesignChallenge = z.infer<typeof designChallengeSchema>;

// ── L1 · Conversational intent (agentdesign.md §3.6) ─────────────────────────

export const intentAction = z.enum([
  'PROBE_EVIDENCE',
  'NEW_GOAL_QUESTION',
  'CALLBACK',
  'REASSURE_AND_RETRY',
  'CORRECT_AND_CONTINUE',
  'CLOSE_GOAL',
  'TRANSITION_SECTION',
  'CLOSE_INTERVIEW',
]);

export const conversationalIntentSchema = z.object({
  action: intentAction,
  target_goal: z.string().nullable(),
  target_skill: z.string().nullable(),
  missing_evidence: z.array(z.string()).max(4),
  /** Which candidate action from the rule layer's shortlist this selects. */
  source_kind: z.enum(['bank', 'followup_bank', 'callback', 'generated', 'none']),
  source_id: z.string().nullable(),
  transition_type: z.enum(['none', 'soft_pivot', 'hard_pivot', 'section_change', 'callback_bridge']),
  emotional_tone: z.enum(['neutral', 'encouraging', 'warm', 'brisk', 'steady']),
  callback_memory_id: z.string().nullable(),
  response_strategy: z.enum(['direct', 'scaffold', 'narrow', 'broaden', 'concrete_example', 'rephrase']),
  difficulty_delta: z.number().int().min(-1).max(1),
  acknowledge_answer: z.boolean(),
  reason: z.string().max(200),
  confidence,
});
export type ConversationalIntent = z.infer<typeof conversationalIntentSchema>;

// ── L4 · Utterance plan (agentdesign.md §3.7) ────────────────────────────────

export const utterancePlanSchema = z.object({
  acknowledgement: z.string().max(60).describe('Neutral only. Never evaluative. May be empty.'),
  transition: z.string().max(160).describe('Bridging clause. May be empty when transition_type is none.'),
  utterance: z.string().max(400).describe('The question itself.'),
  prosody: z.object({
    rate: z.number().min(0.7).max(1.3),
    emotion: z.enum(['neutral', 'encouraging', 'warm', 'brisk', 'steady']),
    emphasis: z.array(z.string()).max(4),
    pause_after_acknowledgement_ms: z.number().int().min(0).max(1200),
  }),
  expected_duration_sec: z.number().min(1).max(40),
  allow_barge_in_after_ms: z.number().int().min(0).max(4000),
});
export type UtterancePlan = z.infer<typeof utterancePlanSchema>;

// ── L2 · Interview memory (agentdesign.md §3.5) ──────────────────────────────

export const memoryKind = z.enum([
  'project',
  'technology',
  'claim',
  'metric',
  'achievement',
  'weakness',
  'strong_answer',
  'unverified_claim',
  'story',
  'leadership_example',
  'behavioral_example',
  'architecture_discussion',
  'coding_hint',
  'company_specific',
]);

export const memoryExtractionSchema = z.object({
  items: z.array(
    z.object({
      kind: memoryKind,
      label: z.string().max(120),
      detail: z.string().max(400),
      technologies: z.array(z.string()).max(8),
      related_skills: z.array(z.string()).max(6),
      confidence,
      importance: confidence,
      depth_signal: z.enum(['surface_mention', 'working_detail', 'implementation_detail', 'design_reasoning']),
      callback_candidates: z.array(
        z.object({ text: z.string().max(160), best_for_goal: z.string(), value: confidence }),
      ).max(2),
    }),
  ).max(6),
  contradictions: z.array(
    z.object({
      detail: z.string().max(300),
      severity: z.enum(['minor', 'major']),
      surface_in_report: z.boolean(),
      probe: z.boolean(),
    }),
  ).max(3),
});
export type MemoryExtraction = z.infer<typeof memoryExtractionSchema>;

// ── E3 · Evidence & knowledge router ─────────────────────────────────────────

export const evidenceRouterSchema = z.object({
  verification_needed: z.boolean(),
  findings: z.array(
    z.object({
      claim: z.string(),
      verdict: z.enum(['supported', 'contradicted', 'inconclusive']),
      explanation: z.string().max(400),
      source_url: z.string().nullable(),
    }),
  ).max(5),
});
export type EvidenceRouterResult = z.infer<typeof evidenceRouterSchema>;

// ── E4 · Answer grading — observations only, never numbers ───────────────────

export const gradingSchema = z.object({
  v: z.literal(2),
  /**
   * Per expected signal in the rubric. S1 turns these into a number; E4 must not
   * (invariant 7). There is deliberately no score field anywhere in this schema.
   */
  concept_coverage: z.array(
    z.object({
      signal_id: z.string(),
      evidence_id: z.string(),
      status: z.enum(['covered', 'partial', 'missing']),
      quoted_span: z.string().max(300).describe('The exact words that earned it. Empty when missing.'),
    }),
  ).max(8),
  incorrect_claims: z.array(
    z.object({
      claim: z.string().max(300),
      correction: z.string().max(400),
      severity: z.enum(['minor', 'major']),
    }),
  ).max(4),
  answered_the_question: z.boolean(),
  // Experiential mode inputs for S1 §9.2
  ownership: z.enum(['clear_individual', 'team_ambiguous', 'observational', 'not_applicable']),
  specificity: z.enum(['high', 'medium', 'low']),
  depth_reached: depthLevel,
  // Behavioral mode inputs for S1 §9.3
  star: z.object({
    has_situation: z.boolean(),
    has_task: z.boolean(),
    has_action: z.boolean(),
    has_result: z.boolean(),
    reflection_quality: confidence,
  }),
  observations: z.array(z.string().max(300)).max(6),
  one_thing_to_change: z.string().max(300),
  /**
   * Coding mode inputs for S1 §9.5. Null for every other grading mode.
   *
   * `test_pass_rate` is deliberately NOT here: it comes from a sandbox run, never
   * from a model's opinion about whether the code works (agentdesign §9.5). These
   * are the three judgements a test runner cannot make.
   */
  coding: z.object({
    /** How close the solution is to the challenge's stated target complexity. */
    complexity_match: confidence,
    /** Naming, structure, edge-case handling. Not style preferences. */
    code_quality: confidence,
    /** Whether they explained the approach as they worked, not just typed. */
    verbal_reasoning: confidence,
  }).nullable(),
});
export type Grading = z.infer<typeof gradingSchema>;

// ── E5 · Rewrite coach ───────────────────────────────────────────────────────

export const rewriteSchema = z.object({
  v: z.literal(2),
  improved: z.string().describe("The candidate's own answer, tightened. Same facts, better shape."),
  ideal: z.string().describe('What a strong candidate would have said.'),
  one_change: z.string().max(300).describe('The single highest-leverage change.'),
  what_improved: z.array(z.string()).max(4),
});
export type Rewrite = z.infer<typeof rewriteSchema>;

// ── E6 · Report composer — narrative only ────────────────────────────────────

export const reportNarrativeSchema = z.object({
  v: z.literal(2),
  summary: z.string().describe('Four to six sentences referencing actual questions.'),
  readiness_band: z.enum(['Not ready', 'Developing', 'Approaching', 'Ready', 'Strong']),
  goal_outcomes: z.array(
    z.object({
      goal_id: z.string(),
      statement: z.string(),
      established: z.boolean(),
      questions_asked: z.number().int().min(0),
      evidence_verified: z.number().int().min(0),
      evidence_total: z.number().int().min(0),
      verdict: z.string().max(300),
    }),
  ).max(20),
  strengths: z.array(z.object({ point: z.string(), evidence_question_seq: z.number().int() })).max(5),
  weaknesses: z.array(
    z.object({
      point: z.string(),
      why_it_matters: z.string(),
      evidence_question_seq: z.number().int(),
    }),
  ).max(5),
  improvement_plan: z.array(
    z.object({
      rank: z.number().int().min(1).max(5),
      action: z.string(),
      effort: z.string().describe('e.g. "one weekend"'),
      success_check: z.string().describe('How they will know it worked.'),
      addresses: z.array(z.string()).max(4),
    }),
  ).min(1).max(5),
  speech_note: z.string().describe('Coaching framing for delivery. Never a verdict on competence.'),
  next_interview_suggestion: z.object({
    focus_areas: z.array(z.string()).max(5),
    recommended_difficulty: z.enum(['easy', 'medium', 'hard']),
  }),
});
export type ReportNarrative = z.infer<typeof reportNarrativeSchema>;

/** Per-skill rollup handed to `finalize_session(p_skills)`. */
export const skillOutcomeSchema = z.object({
  skill: z.string(),
  status: skillStatus,
  score: score10,
  confidence,
  depth: depthLevel,
  jd_importance: confidence.nullable(),
});
export type SkillOutcome = z.infer<typeof skillOutcomeSchema>;

// ── RI · Resume improvement ──────────────────────────────────────────────────

export const resumeSuggestionsSchema = z.object({
  v: z.literal(2),
  suggestions: z.array(
    z.object({
      section: z.string(),
      original: z.string(),
      improved: z.string(),
      why: z.string(),
      addresses_keywords: z.array(z.string()).max(6),
    }),
  ).max(15),
  summary: z.string(),
  projected_ats_gain: z.number().int().min(0).max(40),
});
export type ResumeSuggestions = z.infer<typeof resumeSuggestionsSchema>;

// ── L3v · Live evidence verification ─────────────────────────────────────────

/**
 * One judgement per outstanding evidence item, for the answer just given.
 *
 * Deliberately tiny. This runs inside a live turn against the cheapest model
 * with no reasoning, so the output has to be something a fast model produces
 * reliably: a bounded list of ids it was handed, each with a number and a quote.
 * It is never asked to invent an evidence id, only to rule on the ones given.
 */
export const evidenceVerdictSchema = z.object({
  v: z.literal(2),
  verdicts: z.array(
    z.object({
      evidence_id: z.string(),
      /** Confidence the answer ESTABLISHES this, not that it mentioned it. */
      confidence: confidence,
      /** The words that establish it, quoted from the answer. Null when nothing does. */
      span: z.string().nullable(),
    }),
  ).max(8),
});
export type EvidenceVerdicts = z.infer<typeof evidenceVerdictSchema>;

// ── L6 · Answering the candidate's own question ──────────────────────────────

/**
 * What the interviewer says back when the CANDIDATE asks something.
 *
 * Near the end of an interview the candidate is invited to ask questions, and
 * ignoring what they ask is both rude and a lost signal — what someone asks
 * about a role tells you what they care about. This is the only place in the
 * system where the interviewer supplies information rather than eliciting it,
 * so it is also the only place that can invent a fact about the company. Hence
 * `grounded`: it records whether the answer came from the material or from
 * nowhere, and an ungrounded answer says so out loud instead of guessing.
 */
export const candidateQuestionAnswerSchema = z.object({
  v: z.literal(2),
  /** False when the candidate did not actually ask anything. */
  is_question: z.boolean(),
  /** What they wanted to know, in one line. Empty when is_question is false. */
  question_summary: z.string().max(200),
  /** The spoken reply. Empty when is_question is false. */
  answer: z.string().max(700),
  /** True only when the answer is supported by the JD or company material given. */
  grounded: z.boolean(),
});
export type CandidateQuestionAnswer = z.infer<typeof candidateQuestionAnswerSchema>;
