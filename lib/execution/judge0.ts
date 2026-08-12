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
 */

import type {
  CodeRunner,
  CodeRunRequest,
  CodeRunResult,
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
  typescript: 74, // TypeScript 3.7.4
  java: 62, // Java OpenJDK 13.0.1
  cpp: 54, // C++ GCC 9.2.0
  go: 60, // Go 1.13.5
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
 * Judge0 status ids → our verdicts.
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

interface Judge0Submission {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
  status: { id: number; description: string };
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

    /*
     * Batched, not one request per test.
     *
     * A submit runs every visible AND hidden test — comfortably a dozen. Sent
     * one at a time, each paying its own round trip and queue wait, that is a
     * ten-plus second wait for the candidate and one connection held open the
     * whole time. Judge0's batch endpoint hands the whole set to the worker pool
     * at once, so the wall clock becomes (tests ÷ workers) rather than the sum.
     *
     * It also behaves far better under concurrency: ten candidates submitting
     * become ten batch calls, not a hundred and thirty individual ones.
     */
    const batch = await this.runBatch(base, headers, request);

    // Queue full. Say so rather than manufacturing a wall of failed tests —
    // the candidate's code was never executed.
    if (batch.busy) {
      return { ...emptyResult(request.tests.length, true), busy: true };
    }

    const submissions = batch.submissions;
    const results: TestResult[] = [];
    let compileError: string | undefined;

    request.tests.forEach((test, i) => {
      const submission = submissions[i];

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

      if (verdict === 'compile_error' && !compileError) {
        compileError = (submission.compile_output ?? submission.message ?? 'Compilation failed.').trim();
      }

      results.push({
        verdict,
        input: test.input,
        expected: test.expected,
        actual: (submission.stdout ?? '').trimEnd(),
        stderr:
          (submission.stderr ?? submission.compile_output ?? submission.message ?? undefined)?.trim() ||
          undefined,
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
   * Submits every test as one batch, then polls until the pool has finished.
   *
   * Batch submission is always asynchronous — `wait=true` is not supported on
   * the batch endpoint — so polling is required rather than optional. That is
   * also the behaviour Judge0 recommends for production: holding a connection
   * open per test is what falls over first under load.
   */
  private async runBatch(
    base: string,
    headers: Record<string, string>,
    request: CodeRunRequest,
  ): Promise<{ submissions: Array<Judge0Submission | null>; busy?: boolean }> {
    const body = {
      submissions: request.tests.map((test) => ({
        source_code: request.source,
        language_id: languageId(request.language),
        stdin: test.input,
        expected_output: test.expected,
        cpu_time_limit: request.timeLimitSec ?? 5,
        memory_limit: request.memoryLimitKb ?? 128_000,
      })),
    };

    let tokens: string[];
    try {
      const res = await fetch(`${base}/submissions/batch?base64_encoded=false`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      // 429 is Judge0 refusing work because MAX_QUEUE_SIZE is reached; 503 is
      // the pool being unavailable. Both mean "try again", not "you failed".
      if (res.status === 429 || res.status === 503) {
        console.warn('[judge0] queue full', res.status);
        return { submissions: request.tests.map(() => null), busy: true };
      }

      if (!res.ok) {
        console.error('[judge0] batch submit failed', res.status, (await res.text()).slice(0, 200));
        return { submissions: request.tests.map(() => null) };
      }

      tokens = ((await res.json()) as Array<{ token?: string }>).map((t) => t.token ?? '');
    } catch (err) {
      console.error('[judge0] batch submit error', err);
      return { submissions: request.tests.map(() => null) };
    }

    return { submissions: await this.pollBatch(base, headers, tokens) };
  }

  private async pollBatch(
    base: string,
    headers: Record<string, string>,
    tokens: string[],
  ): Promise<Array<Judge0Submission | null>> {
    const query = tokens.filter(Boolean).join(',');
    if (!query) return tokens.map(() => null);

    const deadline = Date.now() + 60_000;
    // Status 1 = In Queue, 2 = Processing. Anything higher is a final verdict.
    const isDone = (s: Judge0Submission | null) => s !== null && s.status && s.status.id > 2;

    // Start tight, then back off: most interview problems finish in well under a
    // second, but polling every 250ms for a minute would hammer a small box.
    let delay = 300;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 2_000);

      try {
        const res = await fetch(
          `${base}/submissions/batch?tokens=${query}&base64_encoded=false&fields=*`,
          { headers, signal: AbortSignal.timeout(15_000) },
        );
        if (!res.ok) continue;

        const data = (await res.json()) as { submissions: Array<Judge0Submission | null> };
        if (data.submissions.every(isDone)) return data.submissions;
      } catch {
        // Transient — keep polling until the deadline.
      }
    }

    console.error('[judge0] batch timed out', tokens.length, 'tests');
    return tokens.map(() => null);
  }
}

export function emptyResult(total: number, runnerAvailable: boolean): CodeRunResult {
  return { results: [], passed: 0, total, passRate: 0, runnerAvailable };
}
