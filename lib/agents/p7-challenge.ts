/**
 * P7 · Coding Challenge · and SC · Skill Challenge
 *
 * Two rounds, two very different instruments — and two agent ids, because they
 * need different reasoning budgets. P7 buys `high` effort to get hidden-test
 * arithmetic right; SC has no hidden tests and runs at `medium`, which is what
 * stopped it timing out and taking a paid module down with it.
 *
 *   CODING — a LeetCode-style DSA problem, run against hidden tests in a
 *   sandbox. It measures algorithmic reasoning and nothing else.
 *
 *   SKILL — a task in the technology the role actually requires. A React
 *   component, a SQL query against a given schema, a pandas transform, a broken
 *   function to find the fault in — or, where the required skill really is
 *   architecture, a system design scenario. It measures whether someone can do
 *   the job, which a DSA problem does not tell you.
 *
 * Note the invariant that matters for the first: test results come from a
 * sandbox run, never from a model's opinion about whether code works
 * (agentdesign.md §9.5). This agent authors the tests; something else executes
 * them.
 *
 * The second has no sandbox — nothing here can run a React component — so it is
 * validated after the interview by SV (lib/agents/sv-validate.ts) against the
 * `requirements` written here, before the interview started. Same discipline,
 * different instrument: the grading contract is authored at plan time either
 * way, and the number is computed from it by S1 rather than asked for.
 */

import { throwIfAnyPending } from '../ai/durable';
import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { finaliseCodingChallenge } from '../execution/harness';
import { fallbackCodingChallenge, fallbackSkillChallenge } from './p7-fallback';
import {
  codingChallengeDraftSchema,
  skillChallengeSchema,
  type CodingChallenge,
  type DsaTopic,
  type EditorLanguage,
  type SkillChallenge,
  type SkillChallengeFormat,
  type Strategy,
} from './schemas';

const CODING_SYSTEM = `You write ONE data-structures-and-algorithms problem for a timed mock interview. This is a LeetCode-style round and nothing else.

## What this round is

A LeetCode problem. Self-contained, algorithmic, and judged by running the candidate's method against tests and comparing what it returns. The candidate is being measured on data structures, algorithmic reasoning and complexity analysis — not on domain knowledge, not on their resume, not on library familiarity.

Write in the register of the real thing: a short scenario-free statement, explicit constraints, two or three worked examples, and a function signature. If it would not look out of place on LeetCode, it is right.

## What this round is NOT

- NOT a domain problem dressed up as an algorithm. "Parse these log lines" is a worse version of the same exercise: it adds reading comprehension and string-format guesswork to what is meant to be a measurement of algorithmic thinking, and it makes the expected output ambiguous.
- NOT a puzzle or a trick. If the solution depends on spotting one obscure identity, it measures recall, not reasoning.
- NOT framework or library work. No pandas, no requests, no ORM. Standard library only.
- NOT an ambiguous or open-ended question. There is exactly one correct output for every input.

## Difficulty

Calibrate to the stated level, in LeetCode terms:
- easy: one data structure, one pass, the obvious approach is the intended one. Two Sum, Valid Anagram, Merge Two Sorted Lists.
- medium: the naive solution is correct but too slow, and the candidate has to find the better one. Longest Substring Without Repeating Characters, Group Anagrams, Course Schedule.
- hard: two ideas have to be composed, or the state is genuinely non-obvious. Median of Two Sorted Arrays, Word Ladder, Longest Increasing Path in a Matrix.

Solvable AND explainable in 12-18 minutes. A problem nobody finishes produces no signal at all.

## The parts that fail candidates when they are wrong

- constraints: give real bounds. "1 <= n <= 10^5" is what tells the candidate that O(n^2) will not pass, and that is half the exercise. Without bounds there is no target complexity, and a brute force is not wrong.
- visible_tests are shown to the candidate and mirror the examples.
- hidden_tests are the edge cases the naive solution misses: empty input, a single element, all-duplicates, the minimum and maximum of every bound, and the case where the answer is zero or does not exist.
- EVERY hidden test's "expected" value must be correct for your reference_solution. Trace the solution by hand on each one before writing it down. A wrong expected value fails a candidate whose code was right, and it is the single worst defect this agent can ship.

## The signature and the test format

This runs exactly like LeetCode: the candidate writes ONE method, and a harness feeds it the test inputs and reads what it returns. You never write input/output code or starter code — starter code for Python, JavaScript, Java, C++ and C is generated from your signature.

- signature.function_name is a camelCase method name, e.g. twoSum.
- signature.params are 1-4 parameters in order, each a camelCase name and a type.
- signature.return_type is what the method returns. There is always a return value — never an in-place change with nothing returned.
- The types are exactly: int, long, bool, string, int[], long[], string[], int[][]. Nothing else. No floating point. No characters (use a one-letter string). No linked lists, trees or maps as objects — if a problem needs a tree, give it as a level-order int[].
- Every test input is one JSON value per line, one line per parameter, in parameter order. For twoSum(nums: int[], target: int) the input is two lines: [2,7,11,15] on the first and 9 on the second. A string parameter is written as a JSON string with its double quotes, "abcabcbb". A grid is an int[][] such as [[1,1,0],[0,1,1]].
- Every test expected is the JSON of the return value: [0,1], 3, true, "bab".
- The answer must be unique. If the problem naturally has several valid answers, the statement pins one down — "return the indices in increasing order", "return the lexicographically smallest" — and every expected value follows that rule. The grader compares values exactly.
- examples show the same cases for a person to read: the input as nums = [2,7,11,15], target = 9 and the output as [0,1].
- input_format describes the parameters in words; output_format describes the return value.
- Keep test inputs small enough to write out by hand — a few dozen elements at most. The real bounds go in constraints; the tests do not have to reach them.
- reference_solution is Python 3.8: a class Solution with the method named exactly as in signature, taking self first. Use typing's List, not list[int].
- brute_force_note names the naive approach and its complexity, and why the constraints rule it out.
- hints escalate: the first nudges toward the right question, the last names the approach. Never give code in a hint.
- follow_up_question is what the interviewer asks out loud after submission — the "can you do better, and what does it cost you" question. One sentence, speakable.`;

const SKILL_SYSTEM = `You write ONE hands-on task for a timed mock interview, taken from the job the candidate is interviewing for. They answer it in a code editor and it is reviewed afterwards.

This is not an algorithms question. It is the question "can you actually do this job", asked directly.

## The job description is the brief

You are given the role, the skill this task must test, the exact phrase in the posting that skill came from, and what the person in this role will actually be doing. Use all of it.

The task should look like a small piece of the real work. Not "write a function that reverses a list in Kotlin" — that is an algorithms question wearing a technology's clothes. If the posting says the role builds offline-first Android features, the task is a Kotlin one about caching or state restoration. If it says the role maintains dbt models over an events warehouse, the task is a query over an events table. If it says the role writes Terraform for multi-region deploys, the task is a Terraform change. The candidate should recognise it as their job.

Two failure modes to avoid, and they pull in opposite directions:
- A generic exercise that happens to be written in the language. It tests nothing about the technology, which is the entire reason this round exists.
- A task that needs the company's actual codebase, private schema, or internal tooling to attempt. It has to be self-contained: everything needed is in your prompt, your context block and your starter code.

## Ground it in the technology you are given

The skill is decided already — do not substitute your own. If the skill is React, the answer is React code. If it is SQL, the answer is a query. If it is Rust, the answer is Rust.

Where you are told the format and the editor language, use exactly those. Where you are asked to CHOOSE them, choose what someone doing this job would actually produce:
- Prefer implement or debug. They are what most technologies are really tested with.
- query only where the technology is a query language.
- design only where the skill genuinely is architecture — the role is about how systems fit together rather than about writing something. Choosing design for a technology you could have set a task in wastes the round: a written discussion measures much less than working code.
- The editor language must be the one the answer is actually written in. For a Kubernetes or Terraform task that is yaml; for an Android task, kotlin; for iOS, swift; for a shell or CI task, shell. Only ever markdown for a design task.

## The formats

- implement — they build the thing. Give the signature, the props contract or the function stub, and state the behaviour precisely. Scope it to one screen of code: one component, one hook, one endpoint, one transform. "Build a dashboard" is not a task.
- debug — you supply working-looking code that is WRONG, and they find it, fix it, and say why. This is the most informative format and the easiest to get wrong, so:
    · The bug must be real and must be in the starter_code you write. Run it in your head first.
    · It must be a bug a competent person would actually write — a stale closure in a useEffect, a missing dependency, an off-by-one in a slice, a GROUP BY that silently drops rows, an index/label mix-up on a dataframe, a mutation of state instead of a copy.
    · NOT a syntax error, and NOT a typo. Those are found by the editor, not by the candidate.
    · The code around the bug must be sound. One fault, findable by reading.
    · bug_summary states exactly what is wrong and where. This is the answer key and the candidate never sees it.
- query — they write SQL against a schema you supply. Put the CREATE TABLE statements and a handful of sample rows in \`context\`, and say exactly what the result set should contain, with column names. Ask for something that needs a join and an aggregate, or a window function at senior level — never a bare SELECT *.
- design — a system design scenario, discussed rather than written. Scope it to 15 minutes: "design Twitter" is a genre, not a question. Give concrete numbers to reason against — "40k writes/sec, 500ms p99 read" — because "handle a lot of traffic" gives the candidate nothing to push against. Put the outline they fill in into starter_code as short markdown headings.

## requirements — this is the grading contract

Between two and eight of them, and they are what the answer is actually scored on, so write them as things you could point at in the submitted code:
  good: "Cleans up the event listener in the effect's return function"
  good: "Joins orders to customers on customer_id rather than filtering in a subquery"
  bad:  "Demonstrates good understanding of React"

Tier them honestly. must_have is what the answer FAILS without. Weight 3 is reserved for the thing the task is actually about — for a debug task, finding the bug is always a weight-3 must_have.

## The rest

- prompt is what the candidate reads. Speakable in an interview, unambiguous on the page, and it states what "done" looks like.
- context carries the schema, the props contract, the sample data — everything the task needs that is not the task. Null if the prompt genuinely stands alone.
- starter_code is what the editor opens with. For debug this is the broken code. For implement it is imports and a signature and nothing else — never a partial solution. For design it is a few markdown headings.
- reference_solution is the answer you would accept, in full.
- discussion_probes are what the interviewer asks once it is submitted: the trade-off questions that reveal whether they understand their own choices.
- estimated_minutes must be honest. If it does not fit in the time, cut scope until it does.`;

export interface ChallengeInput {
  roleTitle: string;
  seniority: string;
  prioritySkills: string[];
  /**
   * The role's required skills in JD-importance order, each with the phrase in
   * the posting it came from.
   *
   * Distinct from `prioritySkills`, which is what the interview decided to
   * INVESTIGATE — often the gaps. The skill challenge is anchored to what the
   * job requires, and the two lists are combined in `chooseSkillTargets`.
   *
   * `derivedFrom` is what makes the task look like the job rather than like a
   * tutorial: "builds offline-first sync for the Android app" produces a very
   * different Kotlin question than the word "Kotlin" on its own.
   */
  requirements?: Array<{ skill: string; derivedFrom?: string }>;
  /** What the person in this role will actually be doing, from the JD. */
  responsibilities?: string[];
  /** The problem domain — fintech, logistics, genomics. Colour for the task. */
  domainKnowledge?: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  strategy?: Strategy;
  /** What the candidate asked to be interviewed on. Usually empty. */
  focusSkills?: string[];
}

// ── Coding · DSA topic rotation ──────────────────────────────────────────────

/**
 * Topics assigned by slot so a multi-problem round covers different ground.
 *
 * Generation runs in parallel, so the problems cannot coordinate with each
 * other — pinning each slot to a distinct topic is the only thing that stops a
 * three-problem round being three variations on hashing.
 *
 * Each slot lists alternates picked by difficulty: an easy round should not open
 * on dynamic programming, and a hard round should not open on a frequency count.
 */
const CODING_TOPICS: Record<'easy' | 'medium' | 'hard', DsaTopic[]> = {
  easy: ['arrays_hashing', 'two_pointers', 'stack'],
  medium: ['sliding_window', 'trees', 'binary_search'],
  hard: ['graphs', 'dynamic_programming', 'heap_greedy'],
};

/** The LeetCode band each interview difficulty asks for. */
const CODING_LEVEL: Record<'easy' | 'medium' | 'hard', 'easy' | 'medium' | 'hard'> = {
  easy: 'easy',
  medium: 'medium',
  hard: 'hard',
};

export async function runCodingChallenge(
  input: ChallengeInput,
  context?: RunContext,
  slot = 0,
): Promise<CodingChallenge> {
  const topics = CODING_TOPICS[input.difficulty];
  const topic = topics[slot % topics.length];
  const level = CODING_LEVEL[input.difficulty];

  const result = await runAgent({
    agent: 'P7',
    schema: codingChallengeDraftSchema,
    system: CODING_SYSTEM,
    prompt: [
      `Role: ${input.roleTitle} (${input.seniority})`,
      `LeetCode level: ${level}`,
      `Topic for this problem: ${topic.replace(/_/g, ' ')}. Set the \`topic\` field to exactly "${topic}".`,
      /*
       * The role is context for pitching, never for content. Without saying so
       * the model reliably reaches for the candidate's domain and writes a
       * "parse these log lines" problem, which is what this round is explicitly
       * not — see CODING_SYSTEM.
       */
      'The role is here so you pitch the difficulty right. It must NOT influence the subject matter: this is a pure DSA problem, not a problem about their domain.',
      'Write reference_solution in Python 3.8 as class Solution with the method named in signature. Do not write starter code — it is generated from the signature for every language.',
    ].join('\n'),
    context,
    meta: { kind: 'coding', difficulty: input.difficulty, topic, slot },
  });
  /*
   * Starter code for all five languages comes from the signature, never from
   * the model, and any test that does not match the signature is dropped here
   * rather than failing every candidate who runs it. A problem left with no
   * usable tests throws, and the set fills the slot from the built-in bank.
   */
  return finaliseCodingChallenge(result.data);
}

// ── Skill challenge · choosing what to ask ───────────────────────────────────

/**
 * What kind of thing a technology is, and therefore how it can be asked about.
 *
 * Decided in code rather than by the model, for the same reason the DSA topic
 * is: three parallel generations cannot agree among themselves, and a model
 * asked to pick both the skill and the format will pick the same comfortable
 * one every time. Here, a React role reliably gets React and a data role
 * reliably gets SQL.
 */
type SkillKind = 'query' | 'architecture' | 'buildable';

/**
 * The routing table, most specific first.
 *
 * It exists to pin the LANGUAGE the answer is written in, which the model gets
 * wrong often enough to matter — a "Kubernetes" task written in Python is not a
 * Kubernetes task. It is not a whitelist of what may be asked about: anything
 * absent falls through to `null`, and the model picks. That distinction is the
 * whole design, because a table can never list every technology a job posting
 * might name, and one that quietly demoted everything it did not recognise to a
 * written discussion would decide the shape of the interview by omission.
 *
 * Order matters. `sql` before `spark` so "Spark SQL" is a query; frameworks
 * before the bare languages they are written in, so a React role is routed by
 * React rather than by the TypeScript sitting next to it in the same list.
 */
const SKILL_ROUTES: Array<{ kind: SkillKind; language: EditorLanguage; match: RegExp }> = [
  // ── Query languages ───────────────────────────────────────────────────────
  {
    kind: 'query',
    language: 'sql',
    match: /\b(sql|postgres(ql)?|mysql|sqlite|mssql|t-sql|pl\/?sql|oracle|bigquery|snowflake|redshift|athena|hive|presto|trino|clickhouse|duckdb|dbt)\b/i,
  },

  // ── Mobile ────────────────────────────────────────────────────────────────
  { kind: 'buildable', language: 'typescript', match: /\breact native\b/i },
  { kind: 'buildable', language: 'dart', match: /\b(flutter|dart)\b/i },
  { kind: 'buildable', language: 'kotlin', match: /\b(kotlin|android|jetpack compose)\b/i },
  { kind: 'buildable', language: 'swift', match: /\b(swift(ui)?|ios|objective-?c)\b/i },

  // ── Web UI ────────────────────────────────────────────────────────────────
  {
    kind: 'buildable',
    language: 'typescript',
    match: /\b(react|next\.?js|vue|nuxt|svelte|angular|solid\.?js|ember|redux|zustand|remix|astro|frontend|front-end)\b/i,
  },
  { kind: 'buildable', language: 'css', match: /\b(css|scss|sass|less|tailwind|styled-components)\b/i },
  { kind: 'buildable', language: 'html', match: /\b(html|accessibility|a11y|web components)\b/i },
  { kind: 'buildable', language: 'graphql', match: /\bgraphql\b/i },

  // ── Data & ML ─────────────────────────────────────────────────────────────
  {
    kind: 'buildable',
    language: 'python',
    match: /\b(pandas|numpy|scipy|scikit-?learn|sklearn|pytorch|tensorflow|keras|xgboost|hugging ?face|transformers|langchain|llm|nlp|computer vision|opencv|machine learning|deep learning|data science|pyspark|airflow|dagster|prefect|etl|elt|feature engineering|statistics|jupyter|matplotlib)\b/i,
  },
  { kind: 'buildable', language: 'scala', match: /\b(scala|akka)\b/i },
  { kind: 'buildable', language: 'r', match: /\b(rstudio|r programming|tidyverse|ggplot)\b/i },

  // ── Backend frameworks ────────────────────────────────────────────────────
  { kind: 'buildable', language: 'python', match: /\b(django|flask|fastapi|celery)\b/i },
  { kind: 'buildable', language: 'typescript', match: /\b(node\.?js|express|nest\.?js|deno|bun)\b/i },
  { kind: 'buildable', language: 'java', match: /\b(spring|hibernate|jvm)\b/i },
  /*
   * Written without a trailing \b, deliberately.
   *
   * `\bc#\b` never matches anything: \b needs a word character on one side, and
   * `#` at the end of a string has none — so the pattern silently fails on the
   * one string it exists to catch. The same trap takes `.net` on its leading
   * side and `c++` on its trailing side, and it is invisible in review because
   * the regex reads correctly.
   */
  { kind: 'buildable', language: 'csharp', match: /(^|[^a-z0-9])c#|\.net\b|\bdotnet\b|\bentity framework\b/i },
  { kind: 'buildable', language: 'php', match: /\b(php|laravel|symfony|wordpress)\b/i },
  { kind: 'buildable', language: 'ruby', match: /\b(ruby|rails)\b/i },
  { kind: 'buildable', language: 'go', match: /\b(golang|gin|echo framework)\b/i },

  // ── Other language ecosystems ─────────────────────────────────────────────
  { kind: 'buildable', language: 'elixir', match: /\b(elixir|phoenix framework|erlang|otp)\b/i },
  { kind: 'buildable', language: 'solidity', match: /\b(solidity|smart contract|evm|web3|ethereum|blockchain)\b/i },
  { kind: 'buildable', language: 'lua', match: /\b(lua|roblox|love2d)\b/i },

  // ── Infrastructure written as code ────────────────────────────────────────
  { kind: 'buildable', language: 'hcl', match: /\b(terraform|opentofu|hcl)\b/i },
  { kind: 'buildable', language: 'dockerfile', match: /\bdockerfile\b/i },
  {
    kind: 'buildable',
    language: 'yaml',
    match: /\b(kubernetes|k8s|helm|ansible|pulumi|docker compose|github actions|gitlab ci|jenkins|circleci|argo|ci\/cd|manifest)\b/i,
  },
  { kind: 'buildable', language: 'powershell', match: /\b(powershell|windows server|active directory)\b/i },
  { kind: 'buildable', language: 'shell', match: /\b(bash|shell|zsh|linux|scripting|command line)\b/i },

  /*
   * ── Architecture ────────────────────────────────────────────────────────
   * Below infrastructure on purpose. "Kubernetes" is a thing you write a
   * manifest for; "distributed systems" is a thing you discuss. A JD naming
   * both should get the manifest, because working code measures more.
   */
  {
    kind: 'architecture',
    language: 'markdown',
    /*
     * `microservices?` and `scalab\w*` rather than bare stems: a trailing \b
     * after "microservice" cannot match "microservices", and after "scalab"
     * cannot match "scalability" — so both stems, written the obvious way,
     * match only the form nobody writes in a job posting.
     */
    match: /\b(system design|architecture|microservices?|distributed|scalab\w*|high availability|event.driven|message queue|kafka|rabbitmq|capacity planning|observability|sre|mlops|platform design|aws|gcp|azure|cloud)\b/i,
  },

  // ── Bare languages, last: a framework above should win over the language
  //    it happens to be written in.
  { kind: 'buildable', language: 'python', match: /\bpython\b/i },
  { kind: 'buildable', language: 'typescript', match: /\btypescript\b/i },
  { kind: 'buildable', language: 'javascript', match: /\bjavascript\b/i },
  { kind: 'buildable', language: 'java', match: /\bjava\b/i },
  { kind: 'buildable', language: 'go', match: /\bgo\b/i },
  { kind: 'buildable', language: 'rust', match: /\brust\b/i },
  // Same trailing-\b trap as csharp above: `\bc\+\+\b` matches nothing.
  { kind: 'buildable', language: 'cpp', match: /(^|[^a-z0-9])c\+\+|\b(cpp|embedded|qt|unreal engine)\b/i },
];

/**
 * What the routing table knows about a skill, or nothing.
 *
 * `null` is a real answer and not a failure: it means "no strong opinion", and
 * the model is then asked to choose the format and language itself from the
 * job description. That is the correct outcome for Solidity, Salesforce, SAP,
 * Unity, Elixir, LabVIEW and the long tail of things a posting can require —
 * all of which are perfectly good subjects for a task, and none of which belong
 * in a hand-maintained list.
 */
function classify(skill: string): { kind: SkillKind; language: EditorLanguage } | null {
  for (const entry of SKILL_ROUTES) {
    if (entry.match.test(skill)) return { kind: entry.kind, language: entry.language };
  }
  return null;
}

export interface SkillTarget {
  skill: string;
  /** The JD phrase this requirement came from, so the task can look like the job. */
  derivedFrom?: string;
  /** Null when the routing table had no opinion — the model decides. */
  format: SkillChallengeFormat | null;
  editorLanguage: EditorLanguage | null;
}

/**
 * Which skills get asked about, in which format.
 *
 * The order is deliberate. Slot 0 is the most important required skill, because
 * it is the one most likely to be reached before the clock runs out. Formats
 * alternate implement → debug → implement so a multi-question round is not the
 * same exercise twice, and `query` and `design` are forced by the skill rather
 * than rotated: you cannot "debug" an architecture discussion.
 */
export function chooseSkillTargets(input: ChallengeInput, count: number): SkillTarget[] {
  // Required skills lead — this round is about the job. Priority skills (what
  // the interview wanted to investigate) fill in behind them, and de-duplicate
  // case-insensitively so "React" and "react" are not two slots.
  //
  // Ahead of both: focus skills the candidate asked for, but only ones a task
  // can actually be set in — a requirement of this job, or a technology the
  // routing table knows. "Communication" is a fine focus skill and a useless
  // editor task, so it is left to the conversation.
  const focusFirst = (input.focusSkills ?? []).flatMap((skill) => {
    const key = skill.trim().toLowerCase();
    const requirement = (input.requirements ?? []).find((r) => r.skill.trim().toLowerCase() === key);
    if (requirement) return [requirement];
    return classify(skill) ? [{ skill: skill.trim(), derivedFrom: undefined }] : [];
  });

  const seen = new Set<string>();
  const ranked = [
    ...focusFirst,
    ...(input.requirements ?? []),
    ...input.prioritySkills.map((skill) => ({ skill, derivedFrom: undefined })),
  ].filter((r) => {
    const key = r.skill?.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const targets: SkillTarget[] = [];

  for (let slot = 0; slot < count; slot += 1) {
    const requirement = ranked[slot % Math.max(1, ranked.length)];
    const skill = requirement?.skill ?? 'the core technology for this role';
    const route = classify(skill);

    /*
     * Null format means the model chooses, and that is the path for every
     * technology the routing table does not name. Only two things are forced:
     * a query language gets a query, and architecture gets a discussion —
     * because those two are the cases where a model left to itself picks
     * wrongly in a way that wastes the round.
     */
    const format: SkillChallengeFormat | null =
      route === null
        ? null
        : route.kind === 'query'
          ? 'query'
          : route.kind === 'architecture'
            ? 'design'
            : // Even slots build, odd slots debug. Debugging is the more
              // informative of the two, but it cannot be the opener: someone who
              // has not written a line yet reads unfamiliar broken code slowly.
              slot % 2 === 0
              ? 'implement'
              : 'debug';

    targets.push({
      skill,
      derivedFrom: requirement?.derivedFrom,
      format,
      editorLanguage: route?.language ?? null,
    });
  }

  return targets;
}

/** What each format needs said about it at generation time, beyond the system prompt. */
const FORMAT_BRIEF: Record<SkillChallengeFormat, string> = {
  implement:
    'Write an IMPLEMENT task. starter_code holds the imports and the signature only — no partial solution. bug_summary is null.',
  debug:
    'Write a DEBUG task. starter_code holds code that looks right and is not, with exactly one real fault of the kind a competent engineer would actually write. Not a syntax error. bug_summary states what is wrong and where — the candidate never sees it, so be specific. One requirement, at weight 3 and tier must_have, is finding that fault.',
  query:
    'Write a QUERY task. context holds the CREATE TABLE statements and a few sample rows. State the exact columns the result must have. starter_code is a comment naming the tables and an empty query. bug_summary is null.',
  design:
    'Write a DESIGN task — a system design scenario with concrete scale numbers. There is no code: editor_language is markdown and starter_code is a short set of markdown headings for them to fill in. bug_summary is null.',
};

/**
 * What each interview difficulty means for a hands-on task.
 *
 * The coding round has had this since it was written (see CODING_SYSTEM's
 * LeetCode bands); the skill round was handed the bare word "easy" and left to
 * guess, which it did inconsistently — an easy interview could land a
 * multi-file refactor while a hard one got a one-line fix.
 *
 * Scoped in minutes as well as ambition, because a task nobody can finish
 * measures the clock rather than the candidate.
 */
const SKILL_DIFFICULTY_BRIEF: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'EASY. One self-contained thing, in one place, with the approach evident from the requirements. A single function, one component, one query. estimated_minutes 5-8. No unfamiliar API to learn, no edge case they have to discover for themselves.',
  medium:
    'MEDIUM. One thing to build or fix plus one judgement call inside it — an edge case worth handling, a structure worth choosing. estimated_minutes 8-12. They should have to decide something, not just type.',
  hard: 'HARD. Something with a real constraint in it: a correctness trap, a performance requirement, or interacting pieces that must be got right together. estimated_minutes 12-18. A competent engineer should finish it and a careless one should ship something subtly wrong.',
};

export async function runSkillChallenge(
  input: ChallengeInput,
  target: SkillTarget,
  context?: RunContext,
  slot = 0,
): Promise<SkillChallenge> {
  const decided = target.format !== null && target.editorLanguage !== null;

  const result = await runAgent({
    // Its own agent id, not P7's. The coding challenge buys `high` reasoning to
    // get hidden-test arithmetic right; there are no hidden tests here, and
    // paying for that budget anyway is what made this time out.
    agent: 'SC',
    schema: skillChallengeSchema,
    system: SKILL_SYSTEM,
    prompt: [
      `Role: ${input.roleTitle} (${input.seniority})`,
      `Difficulty: ${input.difficulty}`,
      SKILL_DIFFICULTY_BRIEF[input.difficulty],
      input.domainKnowledge?.length ? `Domain: ${input.domainKnowledge.join(', ')}` : '',
      '',
      `SKILL THIS TASK MUST TEST: ${target.skill}`,
      // The phrase from the posting. This is what turns "write a Kotlin
      // function" into a task about the work this role actually does.
      target.derivedFrom
        ? `The posting asks for it like this: "${target.derivedFrom}"`
        : '',
      input.responsibilities?.length
        ? `<what_this_role_does>\n${input.responsibilities.map((r) => `- ${r}`).join('\n')}\n</what_this_role_does>`
        : '',
      '',
      decided
        ? [
            `FORMAT: ${target.format}`,
            `EDITOR LANGUAGE: ${target.editorLanguage} — set \`editor_language\` to exactly this.`,
            FORMAT_BRIEF[target.format!],
            `Set \`skill\` to "${target.skill}" and \`format\` to "${target.format}".`,
          ].join('\n')
        : [
            'FORMAT: you choose. Pick the one that best tests this skill for this role — implement, debug, query or design.',
            'EDITOR LANGUAGE: you choose. It must be the language the answer is actually written in.',
            'Prefer implement or debug. Use design only if this skill genuinely cannot be exercised by writing something, because working code measures far more than a written discussion.',
            'If you choose debug, the starter code must contain one real, findable fault of the kind a competent engineer would write — never a syntax error — and bug_summary must name it. Otherwise bug_summary is null.',
            `Set \`skill\` to "${target.skill}".`,
          ].join('\n'),
      '',
      input.prioritySkills.length
        ? `The rest of this interview is investigating: ${input.prioritySkills.join(', ')}. Do not repeat what those questions would cover.`
        : '',
      'This must be finishable, in an editor, in the minutes you put in estimated_minutes.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    meta: {
      kind: 'skill',
      skill: target.skill,
      format: target.format ?? 'model_choice',
      difficulty: input.difficulty,
      slot,
    },
  });

  /*
   * Pin only what was actually decided here.
   *
   * `skill` is always pinned: the model is told which skill to test and still
   * occasionally answers about a neighbouring one, and skill is what the report
   * attributes the score to. Format and language are pinned only when the
   * routing table chose them — when the model was asked to choose, overwriting
   * its answer with a null would be worse than useless, and its choice is the
   * whole point of that path.
   */
  return decided
    ? {
        ...result.data,
        skill: target.skill,
        format: target.format!,
        editor_language: target.editorLanguage!,
      }
    : { ...result.data, skill: target.skill };
}

/** What gets stored in `sessions.coding_challenge` / `sessions.skill_challenge`. */
export interface ChallengeSet<T> {
  v: 3;
  count: number;
  challenges: T[];
}

/**
 * A round of 1-3 challenges, generated in parallel.
 *
 * `allSettled` rather than `all`, and a failed slot is FILLED, never dropped.
 * The candidate paid a flat fee for this round, and a round that came back
 * empty used to be removed from the interview altogether — coding problems in
 * particular, whose high reasoning budget is the likeliest thing in preparation
 * to run out of time. A failed slot now takes a built-in problem with verified
 * tests (p7-fallback.ts), so the round always has everything it was sized for.
 */
export async function runCodingChallengeSet(
  input: ChallengeInput,
  count: number,
  context?: RunContext,
): Promise<ChallengeSet<CodingChallenge>> {
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => runCodingChallenge(input, context, i)),
  );

  // Still being written is not failed. See lib/ai/durable.ts.
  throwIfAnyPending(results);

  const used = new Set(
    results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.title.toLowerCase()] : [])),
  );

  const challenges = results.map((r, slot) => {
    if (r.status === 'fulfilled') return r.value;

    const fallback = fallbackCodingChallenge(input.difficulty, used);
    used.add(fallback.title.toLowerCase());
    console.warn(`[P7] coding slot ${slot} failed — using built-in "${fallback.title}":`, r.reason);
    return fallback;
  });

  return { v: 3, count: challenges.length, challenges };
}

export async function runSkillChallengeSet(
  input: ChallengeInput,
  count: number,
  context?: RunContext,
): Promise<ChallengeSet<SkillChallenge>> {
  const targets = chooseSkillTargets(input, count);

  const results = await Promise.allSettled(
    targets.map((target, i) => runSkillChallenge(input, target, context, i)),
  );

  throwIfAnyPending(results);

  // Filled rather than dropped, for the same reason as the coding round — with
  // a task templated on the skill this slot was meant to test.
  const challenges = results.map((r, slot) => {
    if (r.status === 'fulfilled') return r.value;

    console.warn(`[P7] skill slot ${slot} (${targets[slot].skill}) failed — using a built-in task:`, r.reason);
    return fallbackSkillChallenge(input, targets[slot]);
  });

  return { v: 3, count: challenges.length, challenges };
}
