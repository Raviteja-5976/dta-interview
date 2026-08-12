/**
 * Live interim transcript — what the candidate sees while they are still talking.
 *
 * ── Why this is the browser's recogniser and not gpt-4o-mini-transcribe ──────
 * The transcription model is not a live one. `/v1/audio/transcriptions` takes a
 * finished clip: you can stream its OUTPUT, but only after the whole recording
 * has been uploaded, so the first word could not appear before the last one was
 * spoken. Genuinely live text over that model means the Realtime API — a
 * WebSocket, an ephemeral token minted server-side, PCM16 framing, and server
 * VAD replacing the silence detection this page already does well.
 *
 * The browser ships a recogniser that does this locally, for free, with no round
 * trip. So it draws the live text, and gpt-4o-mini-transcribe remains the
 * authoritative transcript — the one that reaches L3, E2 and the report. Nothing
 * graded ever comes from here.
 *
 * That split matters: this is a mirror for the candidate, so being fast beats
 * being right. Where it is unsupported (Firefox, most of Safari) the caller
 * falls back to showing the real transcript when the answer completes, exactly
 * as before.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function constructor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function liveTranscriptSupported(): boolean {
  return constructor() !== null;
}

export interface LiveTranscriptHandle {
  stop(): void;
}

/**
 * Starts drawing interim text until `stop()` is called.
 *
 * `onText` receives the whole utterance so far — finalised segments plus the
 * current interim one — so the caller can render it directly without stitching.
 */
export function startLiveTranscript(
  opts: { lang?: string; onText: (text: string) => void },
): LiveTranscriptHandle | null {
  const Ctor = constructor();
  if (!Ctor) return null;

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch {
    return null;
  }

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = opts.lang || 'en-US';
  recognition.maxAlternatives = 1;

  let stopped = false;

  recognition.onresult = (event) => {
    // Rebuilt from the whole result list each time rather than accumulated:
    // the recogniser revises interim segments as it hears more, and appending
    // deltas would leave its earlier guesses stranded in the text.
    let settled = '';
    let interim = '';

    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) settled += text;
      else interim += text;
    }

    opts.onText(`${settled}${interim}`.trim());
  };

  // `no-speech` and `aborted` are ordinary — someone paused, or we stopped it.
  // Anything else means the recogniser is unavailable and the caller simply
  // never sees interim text.
  recognition.onerror = () => {};

  // Chrome ends the session on its own after a stretch of quiet. Restart unless
  // the answer is genuinely over, or the text freezes mid-answer.
  recognition.onend = () => {
    if (stopped) return;
    try {
      recognition.start();
    } catch {
      /* already running, or shutting down */
    }
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop() {
      stopped = true;
      try {
        recognition.abort();
      } catch {
        /* nothing to abort */
      }
    },
  };
}
