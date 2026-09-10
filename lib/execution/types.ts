/**
 * Code execution contracts.
 *
 * Same shape as the model layer: the app names a LANGUAGE and a set of tests,
 * never a vendor. Swapping Judge0 for Piston, or for a self-hosted runner, is
 * one environment variable.
 *
 * agentdesign.md §9.5 is the rule this exists to satisfy: `test_pass_rate` comes
 * from a sandbox run, never from a model's opinion about whether the code works.
 *
 * Plain TypeScript with no imports, so the interview screen can read the
 * language list without pulling anything server-side into the bundle.
 */

/** Languages the coding round offers, in the order the picker shows them. */
export type LanguageId = 'python' | 'javascript' | 'java' | 'cpp' | 'c';

export const LANGUAGES: Array<{ id: LanguageId; label: string; extension: string }> = [
  { id: 'python', label: 'Python3', extension: 'py' },
  { id: 'javascript', label: 'JavaScript', extension: 'js' },
  { id: 'java', label: 'Java', extension: 'java' },
  { id: 'cpp', label: 'C++', extension: 'cpp' },
  { id: 'c', label: 'C', extension: 'c' },
];

export function isLanguageId(value: unknown): value is LanguageId {
  return LANGUAGES.some((l) => l.id === value);
}

/**
 * The types a coding problem's method can take and return.
 *
 * Deliberately small. Every one of them has to be parsed from a test's JSON and
 * printed back in five languages by the harness (harness.ts), and each addition
 * is five parsers and five printers that have to agree. This set covers the
 * problems an interview actually sets; floating point is left out on purpose,
 * because comparing floats printed by five runtimes is a grading bug waiting
 * to happen.
 */
export const VALUE_TYPES = ['int', 'long', 'bool', 'string', 'int[]', 'long[]', 'string[]', 'int[][]'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/** The one method the candidate writes, LeetCode-style. */
export interface FunctionSignature {
  function_name: string;
  params: Array<{ name: string; type: ValueType }>;
  return_type: ValueType;
}

export interface TestCase {
  /** With a signature: one JSON value per line, one line per parameter. */
  input: string;
  /** With a signature: the JSON of the return value. */
  expected: string;
}

export type TestVerdict =
  | 'passed'
  | 'wrong_answer'
  | 'runtime_error'
  | 'time_limit'
  | 'compile_error'
  | 'internal_error'
  /** An earlier case crashed or ran out of time, so this one never ran. */
  | 'not_run';

export interface TestResult {
  verdict: TestVerdict;
  input: string;
  expected: string;
  actual: string;
  stderr?: string;
  timeMs?: number;
  memoryKb?: number;
}

export interface CodeRunResult {
  results: TestResult[];
  passed: number;
  total: number;
  /** Set when the program never got as far as running. */
  compileError?: string;
  /** 0-1. This is what S1's coding score multiplies. */
  passRate: number;
  runnerAvailable: boolean;
  /**
   * The runner was reachable but had no capacity — its queue is full, or the
   * run did not finish inside the request.
   *
   * Distinct from a failed run on purpose. With a small worker pool this is a
   * normal, transient condition, and reporting it as "0 of 13 tests passed"
   * would tell a candidate their correct solution was wrong.
   */
  busy?: boolean;
  /** What the candidate's own print statements wrote, from a run that completed. */
  log?: string;
}

export interface CodeRunRequest {
  language: LanguageId;
  source: string;
  tests: TestCase[];
  /**
   * Present for LeetCode-style problems: `source` is just the candidate's
   * method, and the harness supplies the program around it. Absent for
   * challenges generated before the harness existed, where `source` is a whole
   * program reading stdin.
   */
  signature?: FunctionSignature;
  /** CPU time for the whole run. */
  timeLimitSec?: number;
  memoryLimitKb?: number;
}

export interface CodeRunner {
  readonly name: string;
  isConfigured(): boolean;
  run(request: CodeRunRequest): Promise<CodeRunResult>;
}
