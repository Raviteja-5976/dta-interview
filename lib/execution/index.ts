/**
 * Code runner resolution.
 *
 * `CODE_RUNNER=judge0` today. Adding Piston or a self-hosted runner means one
 * more adapter here and nothing else changes — the interview screen and the
 * scoring engine both talk to the `CodeRunner` interface.
 *
 * When no runner is configured the coding round still works: the candidate
 * writes and submits code, and it is graded on reasoning. What is missing is
 * `test_pass_rate`, which S1 weights at 50% of the coding score — so that score
 * is reported as unavailable rather than computed from the other half and
 * presented as if it were whole.
 */

import { Judge0Runner, emptyResult } from './judge0';
import type { CodeRunRequest, CodeRunResult, CodeRunner } from './types';

export * from './types';

class NullRunner implements CodeRunner {
  readonly name = 'none';
  isConfigured() {
    return false;
  }
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    return emptyResult(request.tests.length, false);
  }
}

const RUNNERS: Record<string, () => CodeRunner> = {
  judge0: () => new Judge0Runner(),
  none: () => new NullRunner(),
};

export function getCodeRunner(): CodeRunner {
  const configured = process.env.CODE_RUNNER ?? 'judge0';
  const runner = (RUNNERS[configured] ?? RUNNERS.judge0)();
  return runner.isConfigured() ? runner : new NullRunner();
}

export function isCodeExecutionAvailable(): boolean {
  return getCodeRunner().isConfigured();
}

/**
 * Normalises output before comparison.
 *
 * Judge0 compares `stdout` to `expected_output` itself, but it is strict about
 * trailing whitespace and line endings — and a candidate whose answer is right
 * but printed with a trailing newline has not got it wrong. This is the
 * second-chance check applied to anything Judge0 marked a wrong answer.
 */
export function outputsMatch(actual: string, expected: string): boolean {
  const clean = (s: string) =>
    s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();

  return clean(actual) === clean(expected);
}
