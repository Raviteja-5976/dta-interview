/**
 * Code execution contracts.
 *
 * Same shape as the model layer: the app names a LANGUAGE and a set of tests,
 * never a vendor. Swapping Judge0 for Piston, or for a self-hosted runner, is
 * one environment variable.
 *
 * agentdesign.md §9.5 is the rule this exists to satisfy: `test_pass_rate` comes
 * from a sandbox run, never from a model's opinion about whether the code works.
 */

/** Languages the interview offers. P7 emits starter code for these. */
export type LanguageId = 'python' | 'javascript' | 'java' | 'cpp' | 'typescript' | 'go';

export const LANGUAGES: Array<{ id: LanguageId; label: string; extension: string }> = [
  { id: 'python', label: 'Python', extension: 'py' },
  { id: 'javascript', label: 'JavaScript', extension: 'js' },
  { id: 'typescript', label: 'TypeScript', extension: 'ts' },
  { id: 'java', label: 'Java', extension: 'java' },
  { id: 'cpp', label: 'C++', extension: 'cpp' },
  { id: 'go', label: 'Go', extension: 'go' },
];

export interface TestCase {
  input: string;
  expected: string;
}

export type TestVerdict =
  | 'passed'
  | 'wrong_answer'
  | 'runtime_error'
  | 'time_limit'
  | 'compile_error'
  | 'internal_error';

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
   * The runner was reachable but had no capacity — its queue is full.
   *
   * Distinct from a failed run on purpose. With a small worker pool this is a
   * normal, transient condition, and reporting it as "0 of 13 tests passed"
   * would tell a candidate their correct solution was wrong.
   */
  busy?: boolean;
}

export interface CodeRunRequest {
  language: LanguageId;
  source: string;
  tests: TestCase[];
  /** Per-test wall clock. Interview problems should never need more. */
  timeLimitSec?: number;
  memoryLimitKb?: number;
}

export interface CodeRunner {
  readonly name: string;
  isConfigured(): boolean;
  run(request: CodeRunRequest): Promise<CodeRunResult>;
}
