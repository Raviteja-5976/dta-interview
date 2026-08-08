/**
 * Shared response helpers for route handlers.
 *
 * The 404-not-403 rule from sitemap-workflow.md §15 lives here: a 403 confirms
 * the resource exists, which tells an attacker something. Ownership failures and
 * missing rows return the same thing.
 */

import { UnauthorizedError } from '../supabase/server';
import { AgentError } from '../ai/run';
import { MissingProviderKeyError } from '../ai/registry';
import { MissingServiceRoleKeyError } from '../supabase/admin';

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, { status: 200, ...init });
}

export function created<T>(data: T): Response {
  return Response.json(data, { status: 201 });
}

/**
 * Error responses say what failed, whether anything was lost, and what to do
 * next — sitemap-workflow.md §16: "Something went wrong" is not an error state.
 */
export function failure(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export function notFound(): Response {
  return failure(404, 'Not found.');
}

export function unauthorized(): Response {
  return failure(401, 'You need to be signed in.');
}

/** Maps thrown errors to responses without leaking internals to the client. */
export function handleRouteError(err: unknown): Response {
  if (err instanceof UnauthorizedError) return unauthorized();

  if (err instanceof MissingProviderKeyError) {
    return failure(503, 'The interview engine is not configured yet.', {
      detail: err.message,
      configuration: true,
    });
  }

  if (err instanceof MissingServiceRoleKeyError) {
    return failure(503, 'The interview engine is not configured yet.', {
      detail: err.message,
      configuration: true,
    });
  }

  if (err instanceof AgentError) {
    return failure(502, 'An AI step failed. Nothing was lost — you can retry.', {
      agent: err.agent,
      detail: err.message,
    });
  }

  console.error('[route]', err);
  return failure(500, 'Something failed on our side. Nothing was charged.');
}
