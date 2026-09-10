/**
 * Judge0 adapter.
 *
 * Works against a self-hosted Judge0 or the managed one on RapidAPI — the only
 * difference is the base URL and which auth header is set.
 *
 *   JUDGE0_URL=https://judge0-ce.p.rapidapi.com
 *   JUDGE0_RAPIDAPI_KEY=...          # managed
 *   # or
 *   JUDGE0_URL=http://your-host:2358
 *   JUDGE0_AUTH_TOKEN=...            # self-hosted, if you set one
 *
 * ── Two ways a run goes ──────────────────────────────────────────────────────
 * LeetCode-style problems (the ones with a signature) run as ONE submission:
 * the harness wraps the candidate's method in a program that runs every test
 * case in turn (harness.ts). Older challenges, where the candidate wrote a
 * whole program, still run one submission per test.
 *
 * ── Why base64 ───────────────────────────────────────────────────────────────
 * With `base64_encoded=false`, Judge0 refuses to return any output that is not
 * valid UTF-8 — a stray byte in a candidate's print statement turns a finished
 * run into an error. Encoding both directions removes that failure entirely.
 */

import {
  buildProgram,
  judgeHarnessRun,
  prepareHarnessRun,
  type ExecutionOutcome,
} from './harness';
import type {
  CodeRunner,
  CodeRunRequest,
  CodeRunResult,
  FunctionSignature,
  LanguageId,
  TestResult,
  TestVerdict,
} from './types';

/**
 * Judge0 language ids.
 *
 * These are NOT stable across Judge0 versions — CE and Extra CE differ, and
 * they change as runtimes are added. `GET /languages` on your instance is the
 * authority; override any of these with JUDGE0_LANG_<LANGUAGE> if they drift.
 * Values below are Judge0 CE 1.13.
 */
const DEFAULT_LANGUAGE_IDS: Record<LanguageId, number> = {
  python: 71, // Python 3.8.1
  javascript: 63, // Node.js 12.14.0
  java: 62, // Java OpenJDK 13.0.1
  cpp: 54, // C++ GCC 9.2.0
  c: 50, // C GCC 9.2.0
};

function languageId(language: LanguageId): number {
  const override = Number(process.env[`JUDGE0_LANG_${language.toUpperCase()}`]);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_LANGUAGE_IDS[language];
}

/** The ids actually in force, after env overrides. Used by the health check. */
export function resolvedLanguageIds(): Array<{ language: LanguageId; id: number; overridden: boolean }> {
  return (Object.keys(DEFAULT_LANGUAGE_IDS) as LanguageId[]).map((language) => ({
    language,
    id: languageId(language),
    overridden: languageId(language) !== DEFAULT_LANGUAGE_IDS[language],
  }));
}

/** Auth headers for whichever Judge0 is configured. Shared with the health check. */
export function judge0Headers(base: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.JUDGE0_RAPIDAPI_KEY) {
    headers['X-RapidAPI-Key'] = process.env.JUDGE0_RAPIDAPI_KEY;
    headers['X-RapidAPI-Host'] = new URL(base).host;
  }
  if (process.env.JUDGE0_AUTH_TOKEN) {
    headers['X-Auth-Token'] = process.env.JUDGE0_AUTH_TOKEN;
  }
  return headers;
}

/**
 * How long one run may take end to end, polling included.
 *
 * The code route is a request on a host that ends every request at 30 seconds.
 * A run still going at this point is reported as busy — nothing recorded, run
 * again — rather than being cut off by the host with no answer at all.
 */
const RUN_DEADLINE_MS = 22_000;

/**
 * Judge0 status ids → our verdicts, for runs that carry an expected output.
 * 1-2 queued/processing, 3 accepted, 4 wrong answer, 5 TLE, 6 compile error,
 * 7-12 runtime errors, 13-14 internal.
 */
function toVerdict(statusId: number): TestVerdict {
  if (statusId === 3) return 'passed';
  if (statusId === 4) return 'wrong_answer';
  if (statusId === 5) return 'time_limit';
  if (statusId === 6) return 'compile_error';
  if (statusId >= 7 && statusId <= 12) return 'runtime_error';
  return 'internal_error';
}

/** The same ids, for a harness run — which has no expected output, so 3 just means it finished. */
function toOutcomeKind(statusId: number): ExecutionOutcome['kind'] {
  if (statusId === 3 || statusId === 4) return 'ok';
  if (statusId === 5) return 'time_limit';
  if (statusId === 6) return 'compile_error';
  if (statusId >= 7 && statusId <= 12) return 'runtime_error';
  return 'internal_error';
}

const encode = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function decode(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return s;
  }
}

interface Judge0Submission {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
  status: { id: number; description: string };
}

interface SubmissionRequest {
  source_code: string;
  language_id: number;
  stdin: string;
  expected_output?: string;
  cpu_time_limit: number;
  wall_time_limit: number;
  memory_limit: number;
}

export class Judge0Runner implements CodeRunner {
  readonly name = 'judge0';

  isConfigured(): boolean {
    return Boolean(process.env.JUDGE0_URL);
  }

  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (!this.isConfigured()) {
      return emptyResult(request.tests.length, false);
    }

    const base = process.env.JUDGE0_URL!.replace(/\/+$/, '');
    const headers = judge0Headers(base);

    return request.signature
      ? this.runHarness(base, headers, request, request.signature)
      : this.runPrograms(base, headers, request);
  }

  /** LeetCode-style: the candidate's method inside the harness, every test in one execution. */
  private async runHarness(
    base: string,
    headers: Record<string, string>,
    request: CodeRunRequest,
    signature: FunctionSignature,
  ): Promise<CodeRunResult> {
    const program = buildProgram(request.language, signature, request.source);
    const prepared = prepareHarnessRun(signature, request.tests);
    const cpu = request.timeLimitSec ?? (request.tests.length > 5 ? 10 : 5);

    const batch = await this.execute(base, headers, [
      {
        source_code: program.source,
        language_id: languageId(request.language),
        stdin: prepared.stdin,
        cpu_time_limit: cpu,
        wall_time_limit: cpu + 5,
        memory_limit: request.memoryLimitKb ?? 256_000,
      },
    ]);

    if (batch.busy) return { ...emptyResult(request.tests.length, true), busy: true };

    const submission = batch.submissions[0];
    if (!submission) return unreachableResult(request);

    return judgeHarnessRun(
      {
        kind: toOutcomeKind(submission.status.id),
        stdout: decode(submission.stdout),
        stderr: decode(submission.stderr),
        compileOutput: decode(submission.compile_output),
        message: decode(submission.message),
      },
      request.tests,
      prepared,
      program.lineOffset,
    );
  }

  /** Challenges from before the harness: the candidate's whole program, once per test. */
  private async runPrograms(
    base: string,
    headers: Record<string, string>,
    request: CodeRunRequest,
  ): Promise<CodeRunResult> {
    const cpu = request.timeLimitSec ?? 5;

    const batch = await this.execute(
      base,
      headers,
      request.tests.map((test) => ({
        source_code: request.source,
        language_id: languageId(request.language),
        stdin: test.input,
        expected_output: test.expected,
        cpu_time_limit: cpu,
        wall_time_limit: cpu + 5,
        memory_limit: request.memoryLimitKb ?? 256_000,
      })),
    );

    // Queue full. Say so rather than manufacturing a wall of failed tests —
    // the candidate's code was never executed.
    if (batch.busy) {
      return { ...emptyResult(request.tests.length, true), busy: true };
    }

    const results: TestResult[] = [];
    let compileError: string | undefined;

    request.tests.forEach((test, i) => {
      const submission = batch.submissions[i];

      if (!submission) {
        results.push({
          verdict: 'internal_error',
          input: test.input,
          expected: test.expected,
          actual: '',
          stderr: 'The code runner did not respond.',
        });
        return;
      }

      const verdict = toVerdict(submission.status.id);
      const compileOutput = decode(submission.compile_output);
      const stderr = decode(submission.stderr);
      const message = decode(submission.message);

      if (verdict === 'compile_error' && !compileError) {
        compileError = (compileOutput ?? message ?? 'Compilation failed.').trim();
      }

      results.push({
        verdict,
        input: test.input,
        expected: test.expected,
        actual: (decode(submission.stdout) ?? '').trimEnd(),
        stderr: (stderr ?? compileOutput ?? message ?? undefined)?.trim() || undefined,
        timeMs: submission.time ? Math.round(Number(submission.time) * 1000) : undefined,
        memoryKb: submission.memory ?? undefined,
      });
    });

    const passed = results.filter((r) => r.verdict === 'passed').length;
    const total = request.tests.length;

    return {
      results,
      passed,
      total,
      compileError,
      passRate: total > 0 ? passed / total : 0,
      runnerAvailable: true,
    };
  }

  /**
   * Submits a batch, then polls until the pool has finished it.
   *
   * Batch submission is always asynchronous — `wait=true` is not supported on
   * the batch endpoint — so polling is required rather than optional. It is
   * also what Judge0 recommends for production: holding a connection open per
   * submission is what falls over first under load.
   */
  private async execute(
    base: string,
    headers: Record<string, string>,
    submissions: SubmissionRequest[],
  ): Promise<{ submissions: Array<Judge0Submission | null>; busy?: boolean }> {
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const none = () => submissions.map(() => null);

    const body = {
      submissions: submissions.map((s) => ({
        ...s,
        source_code: encode(s.source_code),
        stdin: encode(s.stdin),
        ...(s.expected_output !== undefined ? { expected_output: encode(s.expected_output) } : {}),
      })),
    };

    let tokens: string[];
    try {
      const res = await fetch(`${base}/submissions/batch?base64_encoded=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      // 429 is Judge0 (or RapidAPI's quota) refusing work; 503 is the pool
      // being unavailable. Both mean "try again", not "you failed".
      if (res.status === 429 || res.status === 503) {
        console.warn('[judge0] refused: queue full or rate limited', res.status);
        return { submissions: none(), busy: true };
      }

      if (!res.ok) {
        console.error('[judge0] batch submit failed', res.status, (await res.text()).slice(0, 200));
        return { submissions: none() };
      }

      tokens = ((await res.json()) as Array<{ token?: string }>).map((t) => t.token ?? '');
    } catch (err) {
      console.error('[judge0] batch submit error', err);
      return { submissions: none() };
    }

    const query = tokens.filter(Boolean).join(',');
    if (!query) return { submissions: none() };

    // Status 1 = In Queue, 2 = Processing. Anything higher is a final verdict.
    const isDone = (s: Judge0Submission | null) => s !== null && s.status && s.status.id > 2;
    const fields = 'stdout,stderr,compile_output,message,status,time,memory';

    // Start tight, then back off: most interview runs finish in about a second.
    let delay = 250;

    while (Date.now() + delay < deadline) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 1_500);

      try {
        const res = await fetch(
          `${base}/submissions/batch?tokens=${query}&base64_encoded=true&fields=${fields}`,
          { headers, signal: AbortSignal.timeout(Math.max(1_000, Math.min(8_000, deadline - Date.now()))) },
        );
        if (res.status === 429) continue;
        if (!res.ok) continue;

        const data = (await res.json()) as { submissions: Array<Judge0Submission | null> };
        if (data.submissions.every(isDone)) return { submissions: data.submissions };
      } catch {
        // Transient — keep polling until the deadline.
      }
    }

    // Still running when the request has to answer. Reported as busy, so
    // nothing is recorded and the candidate simply runs again.
    console.warn('[judge0] run did not finish inside the request', tokens.length, 'submission(s)');
    return { submissions: none(), busy: true };
  }
}

function unreachableResult(request: CodeRunRequest): CodeRunResult {
  return {
    results: request.tests.map((t) => ({
      verdict: 'internal_error',
      input: t.input,
      expected: t.expected,
      actual: '',
      stderr: 'The code runner did not respond. Your code is saved — run it again.',
    })),
    passed: 0,
    total: request.tests.length,
    passRate: 0,
    runnerAvailable: true,
  };
}

export function emptyResult(total: number, runnerAvailable: boolean): CodeRunResult {
  return { results: [], passed: 0, total, passRate: 0, runnerAvailable };
}
