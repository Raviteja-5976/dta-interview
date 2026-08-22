/**
 * L5's listening leg — live streaming STT, straight from the browser to
 * Deepgram.
 *
 * This replaces two things at once, and that is the point of it.
 *
 * It replaces the browser's own `SpeechRecognition`, which drew the interim
 * text the candidate sees but was never graded — it existed only because the
 * old transcription model could not stream, so the real transcript could not
 * arrive until after the whole clip was uploaded. And it replaces the batch
 * `/transcribe` round trip that produced that real transcript, which ran after
 * the candidate stopped talking and put its whole latency inside the silence
 * following their answer.
 *
 * One socket now does both jobs. Interim results draw the mirror while they
 * talk; final results carry the authoritative transcript AND word-level
 * timestamps, and both are already in hand the moment they stop. The answer
 * reaches `/turn` with no transcription step in front of it.
 *
 * ── Why the browser holds the socket ─────────────────────────────────────────
 * Proxying it through the app would mean the audio travels browser → our server
 * → Deepgram and the transcript comes back the same way, doubling every leg's
 * latency inside the one part of the turn the candidate actually experiences as
 * silence. It also needs a WebSocket-capable server process, which the app does
 * not have — the routes are serverless handlers.
 *
 * The API key is never exposed for it: `/api/voice/token` mints a short-lived
 * JWT with usage rights only (see lib/ai/deepgram.ts).
 *
 * ── End of utterance ─────────────────────────────────────────────────────────
 * agentdesign.md §12 names EOU false positives on hesitant speech as the
 * PRIMARY risk of a cascaded voice stack, and D7 says the design must not treat
 * it as an afterthought. The page previously decided this with an RMS threshold
 * over the microphone, which cannot tell a candidate thinking mid-sentence from
 * one who has finished — both are quiet.
 *
 * `UtteranceEnd` is speech-aware instead: Deepgram fires it from gaps between
 * recognised WORDS, so a pause with breathing, background noise, or a trailing
 * "um" in it is not silence. The page still applies its own floors on top (the
 * response grace window, the minimum answer length), because those encode
 * interview manners rather than acoustics.
 */

import type { WordTiming } from '../engine/types';

const LISTEN_URL = 'wss://api.deepgram.com/v1/listen';

/**
 * Silence, in ms, after the last recognised word before `UtteranceEnd` fires.
 *
 * This is the successor to the page's old 2.5s RMS window, and it is set ABOVE
 * that deliberately rather than at it.
 *
 * The two failure modes are not symmetric. Waiting too long makes the
 * interviewer feel like it takes a beat to respond, which is mildly slow and
 * also what a real interviewer does. Cutting in too early truncates the answer
 * mid-sentence, and that answer is then graded as incomplete — so an impatient
 * threshold does not just feel rude, it costs the candidate marks for something
 * they actually said. Interview answers run a minute or more and people pause
 * inside them constantly, to recall a number or to decide how to phrase
 * something.
 *
 * So: strictly more forgiving than the rule it replaced, and speech-aware on
 * top of it. Deepgram requires at least 1000 and a whole number of seconds.
 */
const UTTERANCE_END_MS = 3000;

/**
 * Silence, in ms, before Deepgram marks a result `speech_final`.
 *
 * Lower than the utterance window on purpose: this closes a TRANSCRIPT segment,
 * it does not end the turn. Finalising segments promptly is what keeps the
 * interim mirror from rewriting text the candidate has already read.
 */
const ENDPOINTING_MS = 800;

export interface LiveSttResult {
  transcript: string;
  words: WordTiming[];
  /** False only when the socket closed before Deepgram returned anything. */
  hasWordTimings: boolean;
  /** Speech span from the word timings — first word start to last word end. */
  durationSec: number;
  confidenceAvg?: number;
}

export interface LiveSttSession {
  /** Feed one MediaRecorder chunk. Ignored once the socket is closing. */
  sendAudio(chunk: Blob): void;
  /**
   * Flush, wait for the trailing final results, and resolve with the answer.
   * Safe to call more than once; later calls get the same promise.
   */
  finish(): Promise<LiveSttResult>;
  /** Tear down without waiting. Used when the interview is abandoned. */
  abort(): void;
  /** False once the socket has errored or closed unexpectedly. */
  readonly alive: boolean;
}

export interface LiveSttOptions {
  /** A short-lived token from /api/voice/token. Never the API key. */
  token: string;
  /** BCP-47 from the session config; the region is dropped for nova-3. */
  language?: string;
  model?: string;
  /** Everything recognised so far — finalised segments plus the live one. */
  onInterim?(text: string): void;
  /** Deepgram heard speech begin. Distinct from the recorder starting. */
  onSpeechStarted?(): void;
  /**
   * New words were recognised — the candidate is still going.
   *
   * This is the CANCELLING half of `onUtteranceEnd`, and a turn that ends
   * correctly depends on both. An utterance end is only ever a guess that
   * someone has finished; the moment another word arrives, that guess was
   * wrong and must be discarded. Without this a candidate who opens with
   * "Um, okay —", thinks, and then gives their real answer is cut off partway
   * through it, because a stale end-of-utterance from the pause is still
   * standing.
   */
  onSpeech?(): void;
  /** The candidate appears to have finished. The page decides what to do. */
  onUtteranceEnd?(): void;
  /** The socket died mid-answer; the caller should fall back to batch. */
  onFailure?(reason: string): void;
}

interface DeepgramLiveWord {
  word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

interface DeepgramLiveMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
      words?: DeepgramLiveWord[];
    }>;
  };
}

export function liveSttSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.WebSocket === 'function';
}

/**
 * Opens the socket and resolves once it is ready for audio.
 *
 * Resolves to `null` rather than throwing when the socket cannot be opened —
 * no token, no network, a blocked WebSocket. The caller then records the answer
 * the old way and transcribes it in batch. Invariant 12: degrade texture, never
 * terminate.
 */
export async function openLiveStt(opts: LiveSttOptions): Promise<LiveSttSession | null> {
  if (!liveSttSupported() || !opts.token) return null;

  const params = new URLSearchParams({
    model: opts.model || 'nova-3',
    language: normaliseLanguage(opts.language),
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    // The two EOU dials. See the constants above.
    endpointing: String(ENDPOINTING_MS),
    utterance_end_ms: String(UTTERANCE_END_MS),
    // Required for UtteranceEnd to be emitted at all, and gives us
    // SpeechStarted for free.
    vad_events: 'true',
  });

  let socket: WebSocket;
  try {
    /*
     * The token rides in the WebSocket subprotocol.
     *
     * A browser cannot set an Authorization header on a WebSocket handshake —
     * `Sec-WebSocket-Protocol` is the only header it will send, so Deepgram
     * reads the credential from there. Putting it in the query string instead
     * would leak it into proxy and server access logs.
     */
    socket = new WebSocket(`${LISTEN_URL}?${params}`, ['bearer', opts.token]);
  } catch {
    return null;
  }

  socket.binaryType = 'arraybuffer';

  const opened = await waitForOpen(socket);
  if (!opened) return null;

  // ── Accumulated state ──────────────────────────────────────────────────────
  /** Finalised segments, in order. These never change again. */
  const finalSegments: string[] = [];
  const words: WordTiming[] = [];
  const confidences: number[] = [];
  /** The segment still being revised. Replaced on every interim message. */
  let interim = '';
  /**
   * Longest combined transcript seen so far.
   *
   * Growth in this is the definition of "new speech arrived", and it is checked
   * rather than simply firing on any non-empty message because interim results
   * are REVISIONS — Deepgram re-sends the current segment as it refines it, and
   * treating a re-send of words we already had as fresh speech would keep
   * cancelling a perfectly good end-of-utterance and the turn would never end.
   */
  let recognisedChars = 0;

  let alive = true;
  let finishing: Promise<LiveSttResult> | null = null;
  let resolveFinish: ((result: LiveSttResult) => void) | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (): LiveSttResult => {
    const transcript = finalSegments.join(' ').replace(/\s+/g, ' ').trim();
    const first = words[0]?.s ?? 0;
    const last = words[words.length - 1]?.e ?? 0;

    return {
      transcript,
      words,
      hasWordTimings: words.length > 0,
      durationSec: Math.max(0, last - first) / 1000,
      confidenceAvg: confidences.length
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : undefined,
    };
  };

  const settle = () => {
    if (!resolveFinish) return;
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = null;
    const done = resolveFinish;
    resolveFinish = null;
    alive = false;
    try {
      socket.close();
    } catch {
      /* already closing */
    }
    done(snapshot());
  };

  socket.onmessage = (event) => {
    let msg: DeepgramLiveMessage;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as DeepgramLiveMessage;
    } catch {
      return;
    }

    if (msg.type === 'SpeechStarted') {
      opts.onSpeechStarted?.();
      return;
    }

    if (msg.type === 'UtteranceEnd') {
      // Do NOT settle here. The page owns the decision to end the turn — it has
      // floors of its own to apply — and it ends the recording, which is what
      // brings us to finish().
      opts.onUtteranceEnd?.();
      return;
    }

    if (msg.type !== 'Results') return;

    const alt = msg.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim() ?? '';

    if (msg.is_final) {
      /*
       * Empty finals are routine — Deepgram closes a segment whenever the
       * endpointing window elapses, including over silence. Recording them
       * would put stray spaces through the middle of the transcript.
       */
      if (text) {
        finalSegments.push(text);
        if (typeof alt?.confidence === 'number') confidences.push(alt.confidence);
      }
      for (const w of alt?.words ?? []) {
        const word = (w.word ?? '').trim();
        if (!word) continue;
        words.push({
          w: word,
          s: Math.round((w.start ?? 0) * 1000),
          e: Math.round((w.end ?? 0) * 1000),
          conf: w.confidence,
        });
      }
      interim = '';
    } else {
      interim = text;
    }

    const combined = [...finalSegments, interim].join(' ').replace(/\s+/g, ' ').trim();

    // Strictly more text than we have ever had means genuinely new words, not a
    // revision of ones we already counted. That is what cancels a pending
    // end-of-utterance.
    if (combined.length > recognisedChars) {
      recognisedChars = combined.length;
      opts.onSpeech?.();
    }

    opts.onInterim?.(combined);

    /*
     * Note what does NOT happen here: settling on the first final that arrives
     * after Finalize.
     *
     * That looks like a free saving and is a truncation bug. Deepgram may emit
     * SEVERAL finals while draining the audio it was still holding, and taking
     * the first one drops the tail of the answer — the last few words a
     * candidate said, which are as likely as any to be the ones the rubric
     * wanted. `CloseStream` makes the server close once it is genuinely done,
     * so `onclose` is the honest completion signal and the guard timer below is
     * the backstop. The close handshake costs milliseconds.
     */
  };

  socket.onerror = () => {
    if (!alive) return;
    alive = false;
    opts.onFailure?.('socket error');
    settle();
  };

  socket.onclose = () => {
    alive = false;
    settle();
  };

  return {
    get alive() {
      return alive;
    },

    sendAudio(chunk: Blob) {
      if (!alive || finishing || socket.readyState !== WebSocket.OPEN) return;
      // Blob goes straight out; the socket frames it. Deepgram sniffs the
      // WebM/Opus container from the first chunk, so chunks must be sent in
      // order and all from the same MediaRecorder session.
      socket.send(chunk);
    },

    finish() {
      if (finishing) return finishing;

      finishing = new Promise<LiveSttResult>((resolve) => {
        resolveFinish = resolve;

        if (socket.readyState !== WebSocket.OPEN) {
          settle();
          return;
        }

        try {
          // Flush audio Deepgram is still holding, then declare the stream over
          // so it emits its trailing finals instead of waiting for more.
          socket.send(JSON.stringify({ type: 'Finalize' }));
          socket.send(JSON.stringify({ type: 'CloseStream' }));
        } catch {
          settle();
          return;
        }

        /*
         * The guard. Everything is already transcribed by this point — the
         * drain is the last few hundred milliseconds of audio — so waiting on
         * it indefinitely would trade a complete transcript for a stalled turn.
         * Whatever has arrived at the deadline is what the answer is.
         */
        finishTimer = setTimeout(settle, 2_000);
      });

      return finishing;
    },

    abort() {
      alive = false;
      resolveFinish = null;
      if (finishTimer) clearTimeout(finishTimer);
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    },
  };
}

function waitForOpen(socket: WebSocket): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    // The candidate is waiting on this before they can answer, so it gets a
    // short leash. Missing it means the batch path, not a broken interview.
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* nothing to close */
      }
      done(false);
    }, 4_000);

    socket.onopen = () => done(true);
    socket.onerror = () => done(false);
    socket.onclose = () => done(false);
  });
}

/** nova-3 takes a bare language code; `en-IN` is rejected. */
function normaliseLanguage(language: string | undefined): string {
  if (!language) return 'en';
  if (language === 'multi') return 'multi';
  return language.split('-')[0] || 'en';
}
