/**
 * Is the code runner actually usable, right now, from this process?
 *
 * `isConfigured()` only answers "is an env var set". That is not the question
 * you have at 11pm after a deploy. The three ways this breaks in practice are:
 * the host is unreachable (security group, wrong URL, container down), the auth
 * token does not match, or the language ids in judge0.ts do not exist on the
 * instance — and each of those fails at a completely different point.
 *
 * Judge0's language ids are not stable across versions, so the ids are checked
 * against `GET /languages` by NAME. A mismatch here is the failure that looks
 * like "the candidate's correct Python was run as Assembly".
 */

import { judge0Headers, resolvedLanguageIds } from './judge0';
import type { LanguageId } from './types';

export interface CodeRunnerHealth {
  runner: string;
  configured: boolean;
  url: string | null;
  authTokenSet: boolean;
  reachable: boolean;
  /** Present when unreachable or refused, so you know which of the two it was. */
  error?: string;
  languages?: Array<{
    language: LanguageId;
    id: number;
    overridden: boolean;
    /** The runtime the instance has at that id, or null when the id is unknown. */
    resolvesTo: string | null;
  }>;
}

export async function checkCodeRunner(): Promise<CodeRunnerHealth> {
  const runner = process.env.CODE_RUNNER ?? 'judge0';
  const url = process.env.JUDGE0_URL?.replace(/\/+$/, '') || null;

  const base: CodeRunnerHealth = {
    runner,
    configured: Boolean(url),
    url,
    authTokenSet: Boolean(process.env.JUDGE0_AUTH_TOKEN || process.env.JUDGE0_RAPIDAPI_KEY),
    reachable: false,
  };

  if (!url) return base;

  try {
    const res = await fetch(`${url}/languages`, {
      headers: judge0Headers(url),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      return {
        ...base,
        error:
          res.status === 401 || res.status === 403
            ? `Judge0 refused the request (${res.status}). JUDGE0_AUTH_TOKEN does not match AUTHN_TOKEN on the instance.`
            : `Judge0 answered ${res.status}.`,
      };
    }

    const available = (await res.json()) as Array<{ id: number; name: string }>;
    const byId = new Map(available.map((l) => [l.id, l.name]));

    return {
      ...base,
      reachable: true,
      languages: resolvedLanguageIds().map((l) => ({ ...l, resolvesTo: byId.get(l.id) ?? null })),
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? `${err.name}: ${err.message}` : 'Could not reach Judge0.',
    };
  }
}
