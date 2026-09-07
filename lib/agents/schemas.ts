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
        'skill_challenge',
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

/**
 * How an answer is judged. Fixed at plan time and never changed (invariant 9).
 *
 * `skill` is the skill-challenge round: something built or fixed in the editor
 * against a stated set of requirements. It is separate from `coding` because
 * the two are measured by different instruments — `coding` has a sandbox and a
 * pass rate, `skill` has a model reading the artifact against requirements
 * written before the interview. Collapsing them would put a number produced by
 * a judgement into the same average as one produced by a measurement.
 */
export const gradingMode = z.enum(['factual', 'experiential', 'behavioral', 'coding', 'skill']);

/**
 * The rubric a single question is graded against.
 *
 * ── Assembled, not authored ──────────────────────────────────────────────────
 * P6 no longer writes one of these per question, because it no longer writes
 * the questions. It writes signals onto each `evidence_required` item instead,
 * and this shape is BUILT at ask time from the evidence a question targets
 * (see `buildRubric` in lib/engine/l3-evidence.ts), then stored on the question
 * record so evaluation grades against exactly what was asked.
 *
 * Invariant 6 is intact: every signal in here was written before the interview
 * started. Only the selection of which ones apply happens live.
 */
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
  ).max(12),
  volatility: z.enum(['stable', 'versioned', 'volatile']),
});
export type Rubric = z.infer<typeof rubricSchema>;

/**
 * The interview's standing context, carried in the blueprint itself.
 *
 * ── Why this is here and not in every prompt ─────────────────────────────────
 * The live interviewer needs to ground its questions in the projects this
 * candidate actually worked on and what this role actually requires. Sending
 * the parsed resume and the full job description on every turn would do that,
 * and would also be the exact failure §10 names — an input that grows until
 * the live agent is slow and unfocused by turn twenty.
 *
 * So P6 reads all of it once, on the `deep` tier, and writes down what a turn
 * actually needs. Bounded, written once, constant size for the whole session.
 */
export const blueprintContextSchema = z.object({
  role_title: z.string(),
  company_name: z.string(),
  seniority: z.string(),
  jd_summary: z
    .string()
    .max(700)
    .describe('What this role needs, in a few sentences. Requirements and responsibilities, not boilerplate.'),
  resume_summary: z
    .string()
    .max(700)
    .describe('Who this candidate is: years, current work, the shape of their experience.'),
  company_summary: z
    .string()
    .max(400)
    .describe('Stack and engineering culture, where known. Empty when there was no company research.'),
  candidate_projects: z
    .array(
      z.object({
        name: z.string(),
        one_line: z.string().describe('What it was and what they did on it.'),
        technologies: z.array(z.string()).max(8),
      }),
    )
    .max(5)
    .describe('What the interviewer can name when anchoring a question to their own work.'),
  claims_worth_probing: z
    .array(z.string())
    .max(6)
    .describe('Specific resume claims the interview should test.'),
  priority_skills: z.array(z.string()).max(10),
});
export type BlueprintContext = z.infer<typeof blueprintContextSchema>;

/**
 * One section of the blueprint.
 *
 * Extracted from `blueprintSchema` so P6 can generate sections INDEPENDENTLY
 * and in parallel. Written as one call, a blueprint is 8-17k tokens of deeply
 * nested JSON on top of a reasoning budget, generated in a single sequential
 * stream — which is minutes of wall clock and was reliably timing out. Each
 * section is a fraction of that, and they have no ordering dependency on each
 * other, so the slowest section is now the whole cost rather than their sum.
 */
export const blueprintSectionSchema = z.object({
  section_id: z.string(),
  type: z.enum([
    'intro',
    'resume_skills',
    'role_skills',
    'behavioral',
    'coding',
    'skill_challenge',
    'closing',
  ]),
  title: z.string(),
  time_budget_sec: z.number().int().min(60).max(2700),
  time_ceiling_sec: z.number().int().min(60).max(3600),
  entry_transitions: z.array(z.string()).min(1).max(3),
  exit_transitions: z.array(z.string()).min(1).max(3),
  /**
   * The section's brief, written FOR the live interviewer.
   *
   * It reads this instead of the resume and the job description, which is
   * the point: the digests live once at the top of the blueprint and the
   * per-section steer lives here, so a turn's prompt stays a constant size
   * however long the interview runs (§10 — context creep is what kills live
   * agents by turn twenty).
   */
  objective: z.string().describe('What this section is for, in one sentence.'),
  question_focus: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      'The KINDS of question to ask here — resume verification, skill check, applied judgement, behavioural.',
    ),
  must_verify: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe('What has to be established before this section is done, in plain language.'),
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
          /*
           * The grading contract, attached to the DESTINATION rather than
           * to one route to it.
           *
           * This used to live on each bank question, which only worked
           * while every question came from the bank. The live interviewer
           * writes its own questions now, and a question with no rubric is
           * ungradeable — so the rubric has to belong to the thing being
           * established, not to the sentence that happened to establish it.
           * Any question targeting this evidence is graded against these
           * signals, however it was worded.
           */
          expected_signals: z.array(
            z.object({
              id: z.string(),
              signal: z.string().describe('What a good answer contains.'),
              accept_if_candidate_says: z.array(z.string()).max(6),
            }),
          ).min(1).max(4),
          /**
           * How an answer to this is judged. Assigned here and never
           * changed (invariant 9) — a generated question inherits the mode
           * of whatever it targets rather than choosing one for itself.
           */
          grading_mode: gradingMode,
          volatility: z.enum(['stable', 'versioned', 'volatile']),
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
      /*
       * Seed questions — examples, not a playlist.
       *
       * The live interviewer writes its own questions now, so this stopped
       * being the pool it selects from. Three things still make it worth
       * P6's effort: the opening question of a section can be
       * pre-synthesised and played from cache at ~0ms; a `deep`-tier model
       * holding the whole gap report calibrates pitch and difficulty better
       * than the live model will, and these anchor it; and when the live
       * call fails there has to be something real to say.
       */
      question_bank: z.array(
        z.object({
          bank_id: z.string(),
          text: z.string(),
          targets_evidence: z.array(z.string()).min(1).max(4),
          difficulty: z.number().int().min(1).max(5),
          grading_mode: gradingMode,
          entry_style: z.enum(['direct', 'story', 'hypothetical', 'comparative']),
        }),
      ).min(1).max(3),
    }),
  ).min(1).max(4),
});
export type BlueprintSection = z.infer<typeof blueprintSectionSchema>;

export const blueprintSchema = z.object({
  v: z.literal(2),
  blueprint_version: z.literal(2),
  estimated_duration_min: z.number().min(5).max(90),
  context: blueprintContextSchema,
  sections: z.array(blueprintSectionSchema).min(2).max(7),
});
export type Blueprint = z.infer<typeof blueprintSchema>;

// ── P7 · Coding challenge (DSA) ──────────────────────────────────────────────

/**
 * The algorithmic topics a coding round draws from.
 *
 * An enum rather than a free string because the slot rotation in p7-challenge.ts
 * uses it to guarantee a multi-problem round covers different ground, and a
 * model free to write "arrays and strings and hashing" for all three would
 * defeat that silently.
 */
export const dsaTopic = z.enum([
  'arrays_hashing',
  'two_pointers',
  'sliding_window',
  'stack',
  'binary_search',
  'linked_list',
  'trees',
  'graphs',
  'heap_greedy',
  'backtracking',
  'dynamic_programming',
  'intervals',
  'matrix',
  'bit_manipulation',
]);
export type DsaTopic = z.infer<typeof dsaTopic>;

export const codingChallengeSchema = z.object({
  v: z.literal(3),
  title: z.string().describe('A LeetCode-style name, e.g. "Longest Substring Without Repeating Characters".'),
  topic: dsaTopic,
  /** The LeetCode band this problem sits in, so the candidate knows what they are looking at. */
  level: z.enum(['easy', 'medium', 'hard']),
  problem_statement: z.string(),
  /** The bounds on n and on the values, which is what decides the target complexity. */
  constraints: z.array(z.string()).min(1).max(6),
  input_format: z.string(),
  output_format: z.string(),
  examples: z.array(z.object({ input: z.string(), output: z.string(), explanation: z.string() })).min(1).max(3),
  starter_code: z.array(z.object({ language: z.string(), code: z.string() })).min(1).max(4),
  visible_tests: z.array(z.object({ input: z.string(), expected: z.string() })).min(1).max(5),
  hidden_tests: z.array(z.object({ input: z.string(), expected: z.string() })).min(1).max(8),
  target_complexity: z.object({ time: z.string(), space: z.string() }),
  /** The naive approach and why it is not good enough. What the follow-up talks about. */
  brute_force_note: z.string(),
  hints: z.array(z.string()).max(3).describe('Escalating — least revealing first.'),
  reference_solution: z.object({ language: z.string(), code: z.string(), commentary: z.string() }),
  /** Asked out loud once the code is submitted — the "now make it better" question. */
  follow_up_question: z.string(),
  skill_tags: z.array(z.string()).max(6),
});
export type CodingChallenge = z.infer<typeof codingChallengeSchema>;

// ── P7 · Skill challenge ─────────────────────────────────────────────────────

/**
 * How a skill challenge is answered. Chosen in code from the skill itself, not
 * by the model — see `SKILL_KINDS` in p7-challenge.ts.
 *
 *   implement — build the thing. A React component, an endpoint, a transform.
 *   debug     — code is supplied and it is wrong. Find it, fix it, say why.
 *   query     — write the SQL against a given schema.
 *   design    — a system design scenario. No editor; they talk it through.
 */
export const skillChallengeFormat = z.enum(['implement', 'debug', 'query', 'design']);
export type SkillChallengeFormat = z.infer<typeof skillChallengeFormat>;

/**
 * What the editor can open a skill challenge in.
 *
 * Wide on purpose. This list is the ONLY constraint on which technologies the
 * skill round can test, so a narrow one silently reshapes the product: with no
 * Kotlin here, an Android role's task has to be written in something else or
 * demoted to a written discussion, and the candidate is no longer being asked
 * about the job. Every value is a Monaco language id, which is why the list can
 * afford to be this long — the editor already ships them all.
 *
 * `markdown` is the deliberate exception: it is not a language the candidate is
 * being tested in, it is the pane a design answer is written into.
 */
export const editorLanguage = z.enum([
  'javascript',
  'typescript',
  'python',
  'sql',
  'java',
  'go',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'rust',
  'kotlin',
  'swift',
  'dart',
  'scala',
  'r',
  'elixir',
  'solidity',
  'lua',
  'shell',
  'powershell',
  'yaml',
  // Terraform is HCL, not YAML. Close enough to read, wrong enough that a
  // candidate writing a resource block gets no highlighting and every string
  // flagged — in a round where the editor is the only feedback they have.
  'hcl',
  'dockerfile',
  'html',
  'css',
  'xml',
  'graphql',
  'markdown',
]);
export type EditorLanguage = z.infer<typeof editorLanguage>;

export const skillChallengeSchema = z.object({
  v: z.literal(3),
  /** The technology this is testing, as the interviewer would say it: "React", "SQL", "PyTorch". */
  skill: z.string(),
  format: skillChallengeFormat,
  title: z.string(),
  /** The task itself. What to build, or what is broken and needs finding. */
  prompt: z.string(),
  /**
   * Everything the task needs that is not the task: a table schema and sample
   * rows for SQL, a props contract for a component, the shape of a dataframe.
   * Null when the prompt stands on its own.
   */
  context: z.string().nullable(),
  /** What the editor opens in. `markdown` only for a `design` challenge. */
  editor_language: editorLanguage,
  /**
   * What the editor opens with.
   *
   * For `debug` this is the BROKEN code and it must actually be broken. For
   * `implement` it is a signature and the imports, never a partial solution.
   * For `design` it is a short outline the candidate fills in.
   */
  starter_code: z.string(),
  /**
   * The grading contract, written before the interview (invariant 6).
   *
   * S1 computes requirement coverage from these weights, so they are load
   * bearing: a `must_have` at weight 3 is three times the credit of a
   * `good_to_have` at weight 1.
   */
  requirements: z.array(
    z.object({
      id: z.string(),
      requirement: z.string().describe('One observable thing a correct answer does.'),
      tier: z.enum(['must_have', 'good_to_have', 'bonus']),
      weight: z.number().int().min(1).max(3),
    }),
  ).min(2).max(8),
  /**
   * For `debug`: what is actually wrong, and where.
   *
   * NEVER sent to the browser. It is the answer key the validator is checked
   * against, and shipping it to the client would put it in devtools.
   */
  bug_summary: z.string().nullable(),
  reference_solution: z.string(),
  hints: z.array(z.string()).max(3).describe('Escalating — least revealing first.'),
  discussion_probes: z
    .array(z.string())
    .max(4)
    .describe('What the interviewer asks once the work is submitted.'),
  estimated_minutes: z.number().int().min(3).max(25),
  skill_tags: z.array(z.string()).max(6),
});
export type SkillChallenge = z.infer<typeof skillChallengeSchema>;

// ── SV · Skill challenge validation (evaluation phase) ───────────────────────

/**
 * The validator's OBSERVATIONS about a skill submission.
 *
 * Invariant 7 again: no score field anywhere in here. SV says which
 * requirements the artifact meets; S1 turns that into a number by formula, so
 * the weights can be retuned without re-running a model and two candidates who
 * met the same requirements get the same score.
 */
export const skillValidationSchema = z.object({
  v: z.literal(3),
  requirements_met: z.array(
    z.object({
      id: z.string().describe('The requirement id from the challenge. Must match exactly.'),
      met: z.enum(['yes', 'partial', 'no']),
      /** The line or expression that earned it, quoted from the submission. */
      evidence: z.string(),
      note: z.string(),
    }),
  ).max(8),
  /** Would this run and do the right thing? Judged, not executed. */
  correctness: score10,
  /** Naming, structure, idiom for the technology. Not formatting. */
  code_quality: score10,
  /** `debug` only — did they find the actual bug? `not_applicable` otherwise. */
  bug_found: z.enum(['yes', 'partial', 'no', 'not_applicable']),
  /** Real defects in what they wrote. Empty is the common case for good answers. */
  defects: z.array(
    z.object({
      severity: z.enum(['major', 'minor']),
      what: z.string(),
      where: z.string().describe('The line or symbol it is in.'),
    }),
  ).max(6),
  strengths: z.array(z.string()).max(4),
  summary: z.string().describe('Two or three sentences a candidate would find useful.'),
  /** For the report, and only ever shown after the interview has ended. */
  verdict: z.enum(['strong', 'acceptable', 'weak', 'incorrect']),
});
export type SkillValidation = z.infer<typeof skillValidationSchema>;

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

// ── IV · The live interviewer's turn ─────────────────────────────────────────

/**
 * What the interviewer decided AND what it says, in one object.
 *
 * ── Why one object and not two agents ────────────────────────────────────────
 * D2/D3 split deciding from wording. That split cannot express the behaviour
 * this design needs: when a candidate answers with "which Spark do you mean?",
 * the reply must come from whatever is holding the conversation, and a split
 * puts the seeing and the deciding in different processes.
 *
 * Invariant 14 is preserved rather than abandoned — the structured decision is
 * still recorded alongside the utterance, so any turn is replayable from what
 * was logged.
 *
 * ── Shape notes ──────────────────────────────────────────────────────────────
 * Flat, no nullables, no nested objects. Strict JSON-schema mode is what makes
 * a fast model reliable at structured output, and it is fussiest about exactly
 * those three things. Empty string means "none" — a null would buy nothing here
 * and costs schema compatibility.
 */
export const interviewerAction = z.enum([
  'ASK',
  'DEEP_DIVE',
  'CLARIFY',
  'ANSWER_QUESTION',
  'REDIRECT',
  'CLOSE_GOAL',
  'NEXT_SECTION',
  'END_INTERVIEW',
]);

export const interviewerTurnSchema = z.object({
  action: interviewerAction,
  /** Goal this turn serves. Empty when the action is not goal-directed. */
  target_goal: z.string().describe('A goal_id from the open goals, or "" if none applies.'),
  /** Evidence ids the question aims at. Decides which rubric grades the answer. */
  targets_evidence: z.array(z.string()).max(4),
  acknowledgement: z
    .string()
    .max(80)
    .describe('Short, neutral receipt of the last answer. Never evaluative. May be empty.'),
  utterance: z.string().max(500).describe('What the candidate actually hears.'),
  emotional_tone: z.enum(['neutral', 'encouraging', 'warm', 'brisk', 'steady']),
  difficulty_delta: z.number().int().min(-1).max(1),
  reason: z.string().max(200).describe('One line, for engineers reading the transcript.'),
});
export type InterviewerTurn = z.infer<typeof interviewerTurnSchema>;

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
   * Coding mode inputs for S1 §9.5. Null for every mode but `coding` and `skill`.
   *
   * `test_pass_rate` is deliberately NOT here: it comes from a sandbox run, never
   * from a model's opinion about whether the code works (agentdesign §9.5). These
   * are the three judgements a test runner cannot make.
   *
   * The skill round reuses this block for `verbal_reasoning` only — whether they
   * explained themselves while working, which is read off the same transcript.
   * Its correctness and code quality come from SV, which has the requirements
   * and the reference solution in front of it and is therefore the better
   * reader; asking E4 for them too would be scoring the same thing twice.
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

/**
 * RI · The resume this candidate could honestly be sending.
 *
 * ── Flat on purpose ─────────────────────────────────────────────────────────
 * A resume is a tree — sections hold entries hold bullets — and modelling it as
 * one would put this at four levels of nesting, which the portability rule at
 * the top of this file exists to prevent. Every line instead carries the section
 * and entry it belongs to as plain strings, and the UI groups them. The model
 * fills a flat list far more reliably than a nested one, and grouping is one
 * line of code.
 *
 * `original` is the load-bearing field. Every rewritten line must quote the text
 * it came from, which is what makes "you may not invent experience" checkable
 * rather than merely instructed: a line with no original is either new structure
 * or a fabrication, and the UI shows it as unsourced.
 */
export const idealResumeSchema = z.object({
  v: z.literal(3),
  headline: z.string().describe('The one-line title under their name, aimed at this role.'),
  summary: z.string().describe('Two or three sentences. Only what the resume already supports.'),
  lines: z.array(
    z.object({
      section: z.string().describe('"Experience", "Projects", "Skills", "Education".'),
      entry: z.string().describe('The job or project this sits under. Empty for section-level lines.'),
      text: z.string().describe('The rewritten line.'),
      original: z
        .string()
        .describe('Verbatim source text from the resume. EMPTY only when this line is new structure, never new fact.'),
      why: z.string().describe('What the rewrite achieves. One short clause.'),
      keywords: z.array(z.string()).max(5).describe("Posting terms this line now matches."),
    }),
  ).max(40),
  /** Lines that should come out, and why. Cutting is half of a good resume. */
  removed: z.array(z.object({ text: z.string(), why: z.string() })).max(6),
  /**
   * The honest part.
   *
   * Skills the role wants that this resume cannot be made to claim, however it
   * is worded, because the experience is not there. Naming them is the
   * difference between a rewrite and a forgery — and it is what the study plan
   * and the project recommendations are then built to fix.
   */
  cannot_claim_yet: z.array(
    z.object({
      skill: z.string(),
      what_would_earn_it: z.string().describe('The smallest real thing that would make the claim true.'),
    }),
  ).max(8),
  ats_notes: z.array(z.string()).max(5).describe('Formatting and keyword fixes, concrete.'),
  projected_ats_gain: z.number().int().min(0).max(40),
});
export type IdealResume = z.infer<typeof idealResumeSchema>;

/**
 * TR · The resume this candidate is aiming AT — not the one they can send today.
 *
 * ── Why this is a separate artifact and a separate agent ────────────────────
 * `idealResumeSchema` above is written under a hard rule: invent nothing, quote
 * the source of every line. This one deliberately contains claims that are not
 * true yet, because that is the entire point of a target — it shows where the
 * prep plan leads.
 *
 * Those two instructions cannot share a prompt. A model told both "never invent
 * anything" and "project forward" blurs them, and it blurs them in the direction
 * that does harm: the sendable resume quietly gains a line the candidate has not
 * earned. Keeping them apart is what protects the document people actually send.
 *
 * `status` is what makes this safe to show. Every line is either `now` (already
 * supported by the real resume) or `earned` (true only once `unlocked_by`
 * happens), and the UI never renders an `earned` line without saying so —
 * including in the text it copies to the clipboard.
 */
export const targetResumeSchema = z.object({
  v: z.literal(3),
  headline: z.string(),
  summary: z.string(),
  lines: z.array(
    z.object({
      section: z.string(),
      entry: z.string(),
      text: z.string(),
      /** `now` — the current resume already supports this. `earned` — it does not, yet. */
      status: z.enum(['now', 'earned']),
      /**
       * For `earned` lines: the specific thing that makes this line true.
       *
       * Names the project or the work from the study plan wherever one applies,
       * so the target and the schedule are visibly the same plan. Empty string
       * for `now` lines.
       */
      unlocked_by: z.string(),
      /** The gap skills this line rests on. Joined against verified progress. */
      depends_on: z.array(z.string()).max(4),
    }),
  ).max(45),
  /**
   * What has to become true before this document is honest.
   *
   * `skill` must be spelled exactly as it appears in the gap report — it is the
   * join key for the live readiness check, which re-evaluates these against what
   * the mock interviews have actually verified every time the page is opened.
   */
  preconditions: z.array(
    z.object({
      skill: z.string(),
      must_become_true: z.string(),
      proof: z.string().describe('What would demonstrate it — the thing an interviewer would accept.'),
    }),
  ).max(8),
  /** One paragraph on the distance between the two resumes. */
  gap_summary: z.string(),
});
export type TargetResume = z.infer<typeof targetResumeSchema>;

// ── SP · Study plan (agent writes offsets; lib/engine/prep-window.ts owns dates)

export const studyPlanSchema = z.object({
  v: z.literal(3),
  /**
   * Whether the time available is actually enough, said plainly.
   *
   * The one field that is allowed to be bad news. A plan that promises full
   * coverage of six missing skills in four days is worse than useless: the
   * candidate spends the four days failing to do it instead of doing the two
   * things that would have moved the needle.
   */
  verdict: z.string(),
  priorities: z.array(
    z.object({
      skill: z.string(),
      why_now: z.string(),
      target_depth: z.enum(['awareness', 'working', 'implementation']),
    }),
  ).max(8),
  /**
   * Portfolio projects worth building before the interview.
   *
   * Empty is a correct and common answer — a resume that already evidences the
   * role's skills through real work does not need a weekend project, and
   * recommending one anyway spends the candidate's scarcest resource on
   * something an interviewer will value less than the job they already did.
   */
  projects_to_build: z.array(
    z.object({
      name: z.string(),
      pitch: z.string().describe('One line: what it is.'),
      builds_evidence_for: z.array(z.string()).max(5).describe('The skills it would actually demonstrate.'),
      scope: z.string().describe('What "finished" means. Bounded enough to finish in the time.'),
      est_hours: z.number().int().min(2).max(60),
      resume_bullet: z.string().describe('The line they could honestly add once it is built and working.'),
    }),
  ).max(3),
  /**
   * The schedule, addressed by DAY OFFSET and never by date.
   *
   * `day_offset` 0 is the first planned day. lib/engine/prep-window.ts resolves
   * these to real calendar dates and discards anything outside the window or
   * duplicated — see the note at the top of that file for why the model is not
   * given dates to work with in the first place.
   */
  blocks: z.array(
    z.object({
      day_offset: z.number().int().min(0).max(41),
      focus: z.string().describe('The one thing this day is for.'),
      kind: z.enum(['study', 'build', 'practice', 'review', 'rest']),
      tasks: z.array(z.string()).max(4).describe('Concrete and checkable. Not "learn React".'),
      est_hours: z.number().min(0.5).max(10),
    }),
  ).max(42),
  /** The last 24 hours, which are for consolidation and sleep, not new material. */
  day_before: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(4).describe('What most likely derails this plan.'),
});
export type StudyPlan = z.infer<typeof studyPlanSchema>;

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
