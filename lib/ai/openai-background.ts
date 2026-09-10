/**
 * OpenAI Responses API in background mode — the transport under durable runs.
 *
 * `background: true` makes the create call return as soon as the request is
 * queued, with an id to poll. The model then runs on OpenAI's side for as long
 * as it needs, and no request of ours is held open while it does. That is the
 * whole trick: a two-minute P7 call becomes one ~1s POST and a handful of
 * ~0.3s GETs, each inside a different 30-second request.
 *
 * Raw fetch rather than the AI SDK, which does not expose background mode. The
 * request body mirrors what @ai-sdk/openai sends for `generateObject` —
 * instructions, a strict json_schema text format, reasoning effort, verbosity —
 * so a background call and an inline call of the same agent ask for the same
 * thing. See `backgroundRequest` in run.ts.
 */

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** Every hop here is short. This bounds one that hangs. */
const HOP_TIMEOUT_MS = 15_000;

export interface ResponseObject {
  id: string;
  /** queued | in_progress | completed | failed | cancelled | incomplete */
  status: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  /** Present on some responses; the SDKs synthesise it. Read defensively. */
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
}

export class OpenAIHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenAIHttpError';
  }
}

async function call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<ResponseObject> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIHttpError(401, 'OPENAI_API_KEY is not set.');

  const res = await fetch(`${RESPONSES_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
    cache: 'no-store',
  });

  const text = await res.text();

  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON — keep the raw text */
    }
    throw new OpenAIHttpError(res.status, `OpenAI ${res.status}: ${message}`);
  }

  return JSON.parse(text) as ResponseObject;
}

/**
 * Queues a response and returns at once. `store: true` is what background mode
 * polls against, and it is also the Responses API's own default — the inline
 * path through the AI SDK was already storing these.
 */
export function createBackgroundResponse(body: Record<string, unknown>): Promise<ResponseObject> {
  return call('', 'POST', { ...body, background: true, store: true });
}

export function retrieveResponse(id: string): Promise<ResponseObject> {
  return call(`/${encodeURIComponent(id)}`, 'GET');
}

/** Best-effort and idempotent. A cancel that fails costs money, not correctness. */
export async function cancelResponse(id: string): Promise<void> {
  await call(`/${encodeURIComponent(id)}/cancel`, 'POST').catch(() => undefined);
}

export function isTerminal(status: string): boolean {
  return status !== 'queued' && status !== 'in_progress';
}

/** The model's text output, or its refusal. */
export function readOutput(response: ResponseObject): { text: string | null; refusal: string | null } {
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return { text: response.output_text, refusal: null };
  }

  let text = '';
  let refusal: string | null = null;

  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) text += part.text;
      if (part.type === 'refusal' && part.refusal) refusal = part.refusal;
    }
  }

  return { text: text || null, refusal };
}

/** The same transport failures run.ts retries on the inline path. */
export function isTransientHttpError(err: unknown): boolean {
  if (err instanceof OpenAIHttpError) {
    return err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error) {
    return (
      err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      /network|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(err.message)
    );
  }
  return false;
}
