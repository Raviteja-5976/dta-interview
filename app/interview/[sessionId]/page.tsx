/**
 * /interview/[sessionId] — the live interview.
 *
 * Interview shell: no sidebar, no top bar, no notifications. The room has one
 * door and it is clearly marked. A "back to dashboard" link during a live voice
 * interview is an invitation to leave mid-session, and leaving costs a credit
 * and produces an unscorable transcript.
 *
 * Rules enforced on this page (sitemap-workflow.md §9):
 *   · The USER starts the interview, not the system. A voice agent that starts
 *     talking on page load catches people mid-sentence with a colleague.
 *   · Never show scores, correctness, or feedback here. Per agentdesign R5,
 *     mid-interview evaluation changes how the candidate performs and corrupts
 *     the data the report is built on.
 *   · No question counter — the interview is goal-driven and the number of
 *     questions is not fixed, so a counter would be a lie.
 *   · Silence is not an error state.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Mic, MicOff, PhoneOff } from 'lucide-react';

import { Button, Card, Chip, ErrorCard, StageList } from '@/components/app/ui';
import { supabase } from '@/lib/supabase/client';

type Phase = 'loading' | 'preparing' | 'ready' | 'speaking' | 'listening' | 'thinking' | 'ended' | 'failed';

/** End-of-utterance: silence for this long ends the answer. */
const SILENCE_MS = 1600;
/** Below this RMS counts as silence. */
const SILENCE_THRESHOLD = 0.045;
/** Never cut someone off before they have really started. */
const MIN_ANSWER_MS = 1200;

export default function LiveInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [question, setQuestion] = useState('');
  const [sectionTitle, setSectionTitle] = useState('');
  const [progress, setProgress] = useState({ sectionsTotal: 0, sectionsCompleted: 0 });
  const [partial, setPartial] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [amplitude, setAmplitude] = useState(0);

  const startedAt = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const answerStartRef = useRef<number>(0);
  const prepFired = useRef(false);

  // ── Elapsed clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!startedAt.current) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current!) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── beforeunload guard while live ──────────────────────────────────────────
  useEffect(() => {
    const live = phase === 'speaking' || phase === 'listening' || phase === 'thinking';
    if (!live) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // ── Load session and trigger prep ──────────────────────────────────────────
  const loadSession = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (!data) {
      setError('We could not find that interview.');
      setPhase('failed');
      return;
    }

    if (data.status === 'complete') {
      router.replace(`/sessions/${sessionId}/report`);
      return;
    }
    if (data.status === 'processing') {
      router.replace(`/sessions/${sessionId}/processing`);
      return;
    }
    if (data.status === 'failed') {
      setError('This interview could not be prepared. Your credits have been returned.');
      setPhase('failed');
      return;
    }

    if (data.status === 'ready' || data.status === 'live') {
      setPhase('ready');
      return;
    }

    setPhase('preparing');
    if (!prepFired.current) {
      prepFired.current = true;
      const res = await fetch(`/api/sessions/${sessionId}/prep`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'failed') {
        setError(body.error ?? 'We could not build your interview. Your credits have been returned.');
        setPhase('failed');
        return;
      }
      setPhase('ready');
    }
  }, [sessionId, router]);

  useEffect(() => {
    // Loads the session and, if needed, fires P6-P8 — an external side effect
    // on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSession();
  }, [loadSession]);

  // ── Audio plumbing ─────────────────────────────────────────────────────────

  const attachAnalyser = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyserRef.current = analyser;
  }, []);

  /** Records one answer, ending on sustained silence. */
  const recordAnswer = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const stream = streamRef.current;
      const analyser = analyserRef.current;
      if (!stream || !analyser) return resolve(null);

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      answerStartRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        resolve(new Blob(chunksRef.current, { type: 'audio/webm' }));
      };

      recorder.start(250);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let silenceSince: number | null = null;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        const rms =
          Math.sqrt(data.reduce((acc, v) => acc + (v - 128) ** 2, 0) / data.length) / 128;

        setAmplitude(Math.min(1, rms * 6));

        const elapsedAnswer = Date.now() - answerStartRef.current;

        if (rms < SILENCE_THRESHOLD) {
          silenceSince ??= Date.now();
          // Silence is not an error state — it just ends the turn once it has
          // been quiet long enough, and only after a real minimum.
          if (Date.now() - silenceSince > SILENCE_MS && elapsedAnswer > MIN_ANSWER_MS) {
            recorder.stop();
            return;
          }
        } else {
          silenceSince = null;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    });
  }, []);

  /** Plays the interviewer's audio, driving the waveform from real amplitude. */
  const speak = useCallback(async (url: string | null, fallbackDurationSec: number) => {
    setPhase('speaking');

    if (!url) {
      // Text is on screen either way — degrade texture, not the run.
      await new Promise((r) => setTimeout(r, fallbackDurationSec * 1000));
      return;
    }

    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audioElRef.current = audio;

      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((acc, v) => acc + (v - 128) ** 2, 0) / data.length) / 128;
        setAmplitude(Math.min(1, rms * 5));
        if (!audio.paused && !audio.ended) requestAnimationFrame(tick);
      };

      audio.onplay = () => tick();
      audio.onended = () => {
        setAmplitude(0);
        void ctx.close();
        resolve();
      };
      audio.onerror = () => {
        void ctx.close();
        resolve();
      };
      void audio.play().catch(() => resolve());
    });
  }, []);

  // ── The loop ───────────────────────────────────────────────────────────────

  const runTurn = useCallback(
    async (answerPayload: Record<string, unknown> | undefined) => {
      setPhase('thinking');

      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: answerPayload,
          elapsedSec: startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'The interview hit a problem.');
        setPhase('failed');
        return null;
      }

      if (data.finished) {
        setPhase('ended');
        router.push(`/sessions/${sessionId}/processing`);
        return null;
      }

      setQuestion(data.question);
      setSectionTitle(data.section?.title ?? '');
      setProgress(data.progress ?? { sectionsTotal: 0, sectionsCompleted: 0 });
      setPartial('');

      await speak(data.audio?.url ?? null, 4);
      return data;
    },
    [sessionId, router, speak],
  );

  /**
   * Records one answer and transcribes it. Returns null when there was nothing
   * usable to send — better to re-ask than to hand silence to the grader.
   */
  const captureAnswer = useCallback(async (): Promise<Record<string, unknown> | null> => {
    setPhase('listening');

    const blob = await recordAnswer();
    if (!blob || blob.size < 1000) return null;

    setPhase('thinking');

    const form = new FormData();
    form.set('audio', new File([blob], 'answer.webm', { type: 'audio/webm' }));

    const res = await fetch(`/api/sessions/${sessionId}/transcribe`, { method: 'POST', body: form });
    const stt = await res.json();

    if (!res.ok) {
      setError(stt.error ?? 'We could not hear that clearly.');
      setPhase('failed');
      return null;
    }

    setPartial(stt.transcript);
    const answerEnd = Date.now();

    return {
      transcript: stt.transcript,
      durationSec: stt.durationSec,
      wordCount: stt.wordCount,
      startMs: answerStartRef.current - (startedAt.current ?? answerStartRef.current),
      endMs: answerEnd - (startedAt.current ?? answerEnd),
      // hasWordTimings=false means E2 marks this answer low-reliability rather
      // than inventing a fluency score for it.
      asrConfidence: stt.hasWordTimings ? undefined : 0.5,
      words: stt.words,
    };
  }, [sessionId, recordAnswer]);

  /**
   * The turn loop. An explicit `while` rather than recursion: a self-referencing
   * callback captures a stale closure of everything it closes over, and after
   * twenty-five turns that is exactly the kind of bug you cannot reproduce.
   */
  const loopRunning = useRef(false);

  const runLoop = useCallback(async () => {
    if (loopRunning.current) return;
    loopRunning.current = true;

    try {
      let answer: Record<string, unknown> | undefined;

      // Bounded so a repeatedly-failing turn can never spin forever.
      for (let guard = 0; guard < 200; guard += 1) {
        const next = await runTurn(answer);
        if (!next) return; // finished, or failed and already surfaced

        answer = (await captureAnswer()) ?? undefined;
      }
    } finally {
      loopRunning.current = false;
    }
  }, [runTurn, captureAnswer]);

  const begin = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      attachAnalyser(stream);
      startedAt.current = Date.now();
      void runLoop();
    } catch {
      setError('We need your microphone to run the interview.');
      setPhase('failed');
    }
  }, [attachAnalyser, runLoop]);

  const endInterview = useCallback(async () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioElRef.current?.pause();

    await fetch(`/api/sessions/${sessionId}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `endNow` ends the interview through the same path a natural finish
      // takes. The real elapsed time still goes with it — it is what the
      // candidate is billed for.
      body: JSON.stringify({
        endNow: true,
        elapsedSec: startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0,
      }),
    }).catch(() => null);

    router.push(`/sessions/${sessionId}/processing`);
  }, [sessionId, router]);

  useEffect(() => {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, [muted]);

  // ── Screens ────────────────────────────────────────────────────────────────

  if (phase === 'loading' || phase === 'preparing') {
    return (
      <Shell>
        <Card className="p-8 max-w-md w-full">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold mb-5">
            Building your interview…
          </h1>
          <StageList
            stages={['Writing your questions', 'Preparing the coding round', 'Warming up the voice']}
            current={1}
          />
        </Card>
      </Shell>
    );
  }

  if (phase === 'failed') {
    return (
      <Shell>
        <div className="max-w-md w-full">
          <ErrorCard
            heading="This interview stopped"
            body={error ?? 'Something went wrong.'}
            action={<Button href="/dashboard">Back to dashboard</Button>}
          />
        </div>
      </Shell>
    );
  }

  if (phase === 'ready') {
    return (
      <Shell>
        <Card className="p-8 md:p-12 max-w-lg w-full text-center">
          <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold mb-3">
            Ready when you are.
          </h1>
          <p className="text-sm text-[#1B1F3B]/70 mb-8">
            You&apos;ll be speaking out loud. Answer naturally — pauses are fine, and there&apos;s no
            question counter to race.
          </p>
          <Button onClick={begin} className="text-base px-8 py-4">
            <Mic className="w-5 h-5" /> Begin
          </Button>
        </Card>
      </Shell>
    );
  }

  const live = phase === 'speaking' || phase === 'listening' || phase === 'thinking';

  return (
    <Shell>
      <div className="w-full max-w-3xl flex flex-col h-full">
        {/* Top strip — no question counter, by design */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Chip>{formatTime(elapsed)}</Chip>
            {sectionTitle && <Chip accent="sky">{sectionTitle}</Chip>}
          </div>
          <div className="flex gap-1">
            {Array.from({ length: progress.sectionsTotal || 1 }).map((_, i) => (
              <div
                key={i}
                className={`w-8 h-2 rounded-full border-2 border-[#1B1F3B] ${
                  i < progress.sectionsCompleted ? 'bg-[#6EE7B7]' : 'bg-white'
                }`}
              />
            ))}
          </div>
        </div>

        {/* The question — stays on screen for the whole answer */}
        <div className="flex-1 flex flex-col justify-center">
          <p className="font-[family-name:var(--font-display)] text-2xl md:text-4xl font-extrabold text-[#1B1F3B] text-center leading-snug mb-10">
            {question}
          </p>

          <Waveform phase={phase} amplitude={amplitude} />

          <p className="text-center font-[family-name:var(--font-mono)] text-xs uppercase tracking-widest text-[#1B1F3B]/50 mt-4">
            {phase === 'speaking' ? 'Interviewer speaking' : phase === 'listening' ? 'Listening' : 'Thinking'}
          </p>

          {/* Your own words, streaming back — makes mistranscription visible */}
          {partial && (
            <div className="mt-8 p-4 bg-white border-4 border-[#1B1F3B] rounded-3xl max-h-40 overflow-y-auto">
              <p className="text-sm text-[#1B1F3B]/80 leading-relaxed">{partial}</p>
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            onClick={() => setMuted(!muted)}
            className={`p-4 rounded-2xl border-4 border-[#1B1F3B] shadow-[3px_3px_0_#1B1F3B] transition-all ${
              muted ? 'bg-[#FF5C7A] text-white' : 'bg-white text-[#1B1F3B]'
            }`}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {confirmEnd ? (
            <div className="flex items-center gap-2">
              <Button variant="danger" onClick={endInterview}>
                End it — I&apos;m done
              </Button>
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                Keep going
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmEnd(true)} disabled={!live}>
              <PhoneOff className="w-4 h-4" /> End interview
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

/**
 * Amplitude-driven, not a decorative loop. It is the only indicator of whether
 * the system is speaking, thinking, or listening, so it has to be honest (§9).
 */
function Waveform({ phase, amplitude }: { phase: Phase; amplitude: number }) {
  const bars = 16;
  const color = phase === 'speaking' ? '#FF6B35' : phase === 'listening' ? '#4EA8FF' : '#FFC93C';

  return (
    <div className="flex items-center justify-center gap-1.5 h-24" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        // Sine stagger so the shape reads as a voice rather than a bar chart.
        const wave = Math.sin((i / bars) * Math.PI);
        const height =
          phase === 'thinking'
            ? 12 + wave * 10
            : 8 + amplitude * 70 * (0.4 + wave * 0.6);

        return (
          <div
            key={i}
            style={{
              height: `${Math.max(8, height)}px`,
              backgroundColor: color,
              transition: 'height 90ms linear',
            }}
            className={`w-2.5 rounded-full border-2 border-[#1B1F3B] ${
              phase === 'thinking' ? 'animate-pulse' : ''
            }`}
          />
        );
      })}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center p-4 md:p-8">
      {children}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
