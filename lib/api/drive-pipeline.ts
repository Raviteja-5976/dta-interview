/**
 * Drives a durable pipeline from the browser: POST, and POST again, until it
 * settles.
 *
 * The four long pipelines — project prep, the prep plan, session prep and
 * evaluation — each take one to three minutes, and the host ends every request
 * at 30 seconds. So the server never runs one to completion inside a request:
 * each POST advances it by one short pass and answers `pending: true` until the
 * pass that finishes it (lib/pipelines/pipeline-runs.ts). This is the loop on
 * the other end of that.
 *
 * A dropped request is not a failed pipeline. The run's state lives in the
 * database, so a 5xx or a network blip is retried with backoff, and only a run
 * of them in a row is reported. A 4xx is the server's answer, and is final.
 *
 * Client-safe: no server imports.
 */

export type DriveOutcome<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; body: T | null; error: string };

export interface DriveOptions<T> {
  /** Every successful response, including the last. */
  onUpdate?: (body: T) => void;
  /** Stops the loop between requests. Tie it to the component's lifetime. */
  signal?: AbortSignal;
  intervalMs?: number;
  /** Give up after this long. The run survives it; reopening the page resumes. */
  timeoutMs?: number;
}

const MAX_CONSECUTIVE_FAILURES = 6;

export async function drivePipeline<T extends { pending?: boolean; error?: string }>(
  /**
   * One request. `answered` counts the responses the server has already given,
   * so the first request can start the run and the rest can advance it.
   */
  step: (answered: number) => Promise<Response>,
  opts: DriveOptions<T> = {},
): Promise<DriveOutcome<T>> {
  const interval = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);

  let answered = 0;
  let failures = 0;
  let last: T | null = null;

  for (;;) {
    if (opts.signal?.aborted) return { ok: false, status: 0, body: last, error: 'Cancelled.' };

    let res: Response | null = null;
    let body: T | null = null;
    try {
      res = await step(answered);
      body = (await res.json().catch(() => null)) as T | null;
    } catch {
      res = null;
    }

    if (res?.ok && body) {
      answered += 1;
      failures = 0;
      last = body;
      opts.onUpdate?.(body);
      if (!body.pending) return { ok: true, body };
    } else if (res && res.status >= 400 && res.status < 500) {
      return { ok: false, status: res.status, body, error: body?.error ?? 'That request was refused.' };
    } else {
      // A gateway timeout, a 5xx or no response at all. The next request picks
      // up from whatever the last pass saved.
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        return {
          ok: false,
          status: res?.status ?? 0,
          body,
          error:
            body?.error ??
            'We lost contact with the server. Refresh the page and it will pick up where it stopped.',
        };
      }
    }

    if (Date.now() > deadline) {
      return {
        ok: false,
        status: 0,
        body: last,
        error: 'This is taking much longer than it should. Refresh the page to check on it.',
      };
    }

    const wait = failures > 0 ? Math.min(15_000, interval * 2 ** failures) : interval;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
