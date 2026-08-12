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
import CodingMode, { type CodeDraft, type CodingChallengeView } from '@/components/app/CodingMode';
import { SESSION_PREP_STAGES } from '@/lib/pipelines/prep-stages';
import { startLiveTranscript, type LiveTranscriptHandle } from '@/lib/speech/live-transcript';
import { supabase } from '@/lib/supabase/client';

type Phase = 'loading' | 'preparing' | 'ready' | 'speaking' | 'listening' | 'thinking' | 'ended' | 'failed';

/**
 * Nothing may end the turn within this window of the question finishing.
 *
 * A real person hears a question, thinks, and then starts talking. Judging the
 * microphone the instant the interviewer stops means the candidate is racing a
 * timer they cannot see. This is a hard floor: no stop decision of any kind is
 * taken before it elapses.
 */
const RESPONSE_GRACE_MS = 5_000;

/**
 * End-of-utterance: silence for this long AFTER speech has started ends the
 * answer.
 *
 * Deliberately generous. People pause mid-answer — to recall a detail, to
 * decide how to phrase something — and cutting in after a second and a half of
 * that reads as being interrupted, which is exactly what makes a voice agent
 * feel unnatural.
 */
const SILENCE_MS = 2_500;

/** Below this RMS counts as silence. */
const SILENCE_THRESHOLD = 0.045;

/** Never cut someone off before they have really started. */
const MIN_ANSWER_MS = 1_200;

/**
 * How long to wait for the candidate to begin at all.
 *
 * sitemap §9: eight seconds of quiet is a thinking pause, not a finished
 * answer. Waiting past that hands back so the interviewer can prompt.
 */
const WAIT_FOR_SPEECH_MS = 12_000;

interface CodingSummary {
  passed: number;
  total: number;
  language: string;
  source: string;
}

interface RecordedAnswer {
  blob: Blob;
  /** When speech actually began — not when the recorder did. */
  startedAt: number;
  endedAt: number;
}

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
  const [prepStage, setPrepStage] = useState(0);
  const [prepDetail, setPrepDetail] = useState<string | null>(null);
  /** Non-null while the candidate is in the editor. */
  const [challenge, setChallenge] = useState<CodingChallengeView | null>(null);

  const startedAt = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  /** Cuts the clip that is currently playing. Set by playClip while it runs. */
  const stopPlaybackRef = useRef<(() => void) | null>(null);
  /** Set once the interview is over, so nothing queued keeps running. */
  const aborted = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** The browser recogniser drawing interim text, while an answer is in flight. */
  const liveTranscriptRef = useRef<LiveTranscriptHandle | null>(null);
  /** The question currently on screen, so /reflect knows what it is reading. */
  const lastQuestionIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const answerStartRef = useRef<number>(0);
  const prepFired = useRef(false);
  /**
   * Total seconds spent in the editor. Subtracted from the billable duration —
   * the coding round is paid for by its flat module fee, so metering its
   * minutes again would charge for the same time twice.
   */
  const codingSecRef = useRef(0);
  const codingStartedAt = useRef<number | null>(null);

  /**
   * Starts the coding pause. Called at exactly the point the editor goes on
   * screen, so the unbilled window is the window the candidate can actually see
   * a problem in — not a separate clock that happens to run alongside it.
   */
  const pauseBillingForCoding = useCallback(() => {
    codingStartedAt.current ??= Date.now();
  }, []);

  /** Banks the open segment. Idempotent — safe to call when nothing is running. */
  const resumeBillingAfterCoding = useCallback(() => {
    if (codingStartedAt.current === null) return;
    codingSecRef.current += (Date.now() - codingStartedAt.current) / 1000;
    codingStartedAt.current = null;
  }, []);

  /**
   * Total unbilled coding seconds INCLUDING the segment currently in flight.
   *
   * The one number every reader must use. `codingSecRef` alone only holds
   * completed segments, so anything reading it directly while the editor is open
   * sees zero for the round in progress — which is how ending an interview
   * mid-problem billed the whole coding round as conversation time.
   */
  const codingSecondsSoFar = useCallback(
    () =>
      codingSecRef.current +
      (codingStartedAt.current ? (Date.now() - codingStartedAt.current) / 1000 : 0),
    [],
  );
  /** Resolves when the candidate submits, which is what un-pauses the loop. */
  const codingDoneRef = useRef<((summary: CodingSummary) => void) | null>(null);
  /**
   * What the candidate has typed, per challenge index.
   *
   * The editor closes between turns — a coding section can run several turns,
   * and the interviewer may come back to the same problem after a follow-up.
   * Without this the editor would remount on blank starter code and silently
   * throw away work someone spent ten minutes on.
   */
  const codeDrafts = useRef<Record<number, CodeDraft>>({});

  const getCodeDraft = useCallback((index: number) => codeDrafts.current[index], []);
  const saveCodeDraft = useCallback((index: number, draft: CodeDraft) => {
    codeDrafts.current[index] = draft;
  }, []);

  // ── Elapsed clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!startedAt.current) return;
    const id = setInterval(() => {
      // The displayed clock is the billed one — same helper, no second formula
      // that could drift from what the candidate is actually charged.
      const billable = Date.now() - startedAt.current! - codingSecondsSoFar() * 1000;
      setElapsed(Math.max(0, Math.floor(billable / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, codingSecondsSoFar]);

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

  /**
   * Follows prep progress while the session is being built.
   *
   * The prep request is a single long-lived POST, so it reports nothing until it
   * finishes. This subscription is what makes the wait legible — the pipeline
   * writes each stage to `sessions.progress` as it reaches it.
   */
  useEffect(() => {
    if (phase !== 'preparing') return;

    const channel = supabase
      .channel(`session-prep:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        ({ new: row }) => {
          const next = row as { progress?: { index?: number; detail?: string | null } };
          if (typeof next.progress?.index === 'number') setPrepStage(next.progress.index);
          setPrepDetail(next.progress?.detail ?? null);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, phase]);

  // ── Audio plumbing ─────────────────────────────────────────────────────────

  const attachAnalyser = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyserRef.current = analyser;
  }, []);

  /**
   * Records one answer.
   *
   * The rule that matters: trailing silence only ends the turn once the
   * candidate has ACTUALLY SPOKEN. Stopping on silence unconditionally meant
   * anyone who paused to think for three seconds had their turn submitted as an
   * empty clip — which is where "we didn't catch that" came from. Thinking
   * before answering is normal interview behaviour, not the end of an answer.
   *
   * Returns the clip plus the speech window, which is what E2 needs for pace now
   * that the transcript carries no per-word timing.
   */
  const recordAnswer = useCallback((): Promise<RecordedAnswer | null> => {
    return new Promise((resolve) => {
      const stream = streamRef.current;
      const analyser = analyserRef.current;

      // A stopped track cannot be recorded: MediaRecorder.start() throws
      // NotSupportedError rather than failing gracefully. This happens when the
      // interview ended while the loop was mid-flight.
      const live = stream?.getAudioTracks().some((t) => t.readyState === 'live');
      if (!stream || !analyser || !live) return resolve(null);

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        return resolve(null);
      }

      chunksRef.current = [];
      recorderRef.current = recorder;
      answerStartRef.current = Date.now();

      /*
       * Interim text, drawn as they talk. Local to the browser and never graded
       * — the clip still goes to the transcription model, and that transcript is
       * what reaches the tracker and the report.
       */
      const liveText = startLiveTranscript({ onText: setPartial });
      liveTranscriptRef.current = liveText;

      let speechStartedAt: number | null = null;
      let speechEndedAt: number | null = null;
      let silenceSince: number | null = null;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        liveText?.stop();
        liveTranscriptRef.current = null;
        setAmplitude(0);

        if (speechStartedAt === null) return resolve(null); // nothing was said

        resolve({
          blob: new Blob(chunksRef.current, { type: 'audio/webm' }),
          startedAt: speechStartedAt,
          endedAt: speechEndedAt ?? Date.now(),
        });
      };

      try {
        recorder.start(250);
      } catch {
        return resolve(null);
      }

      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (recorder.state !== 'recording') return;

        analyser.getByteTimeDomainData(data);
        const rms =
          Math.sqrt(data.reduce((acc, v) => acc + (v - 128) ** 2, 0) / data.length) / 128;

        setAmplitude(Math.min(1, rms * 6));

        const now = Date.now();
        const speaking = rms >= SILENCE_THRESHOLD;
        const sinceQuestion = now - answerStartRef.current;

        if (speaking) {
          speechStartedAt ??= now;
          speechEndedAt = now;
          silenceSince = null;
        } else {
          silenceSince ??= now;

          // The grace floor. No stop decision at all until it has passed, so a
          // candidate who takes a moment to gather their thoughts is never cut
          // off before they have begun.
          if (sinceQuestion < RESPONSE_GRACE_MS) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          if (speechStartedAt !== null) {
            // They spoke and have now stopped — end the turn.
            if (now - silenceSince > SILENCE_MS && now - speechStartedAt > MIN_ANSWER_MS) {
              recorder.stop();
              return;
            }
          } else if (sinceQuestion > WAIT_FOR_SPEECH_MS) {
            // Still nothing. Hand back so the interviewer can prompt, rather
            // than posting silence to the transcriber.
            recorder.stop();
            return;
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    });
  }, []);

  /**
   * Plays one clip, driving the waveform from its real amplitude.
   *
   * A turn arrives as an ordered list of clips — acknowledgement, transition,
   * question — because P8 caches each separately and resolving them separately
   * is what lets most of them come from cache.
   */
  const playClip = useCallback(async (url: string, fallbackDurationSec: number) => {
    const audio = new Audio();
    /*
     * MUST be set before `src`, and only for the cross-origin case.
     *
     * Cached clips come from Supabase Storage — a different origin. Feeding a
     * cross-origin media element into `createMediaElementSource` without this
     * taints the audio graph, and the browser responds by routing SILENCE
     * through it. No exception, no console warning, no failed request: the
     * waveform animates, the turn advances, and nothing is audible.
     *
     * Live segments stream from our own /speak route, where setting it would
     * instead suppress the session cookie the route authenticates with.
     */
    if (!url.startsWith('/')) audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = url;
    audioElRef.current = audio;

    // The analyser is what makes the waveform honest (sitemap §9), but it is
    // also the part that can fail. If wiring it up throws — CORS refused, or
    // the element is already attached to another context — fall back to plain
    // playback. A flat waveform is a cosmetic loss; silence is not.
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;

    try {
      ctx = new AudioContext();
      // A context created outside a user gesture starts suspended, and a
      // suspended context plays nothing.
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
    } catch {
      void ctx?.close();
      ctx = null;
      analyser = null;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        stopPlaybackRef.current = null;
        // Pausing matters as much as resolving: a clip that is merely detached
        // from the promise keeps making sound.
        audio.pause();
        setAmplitude(0);
        void ctx?.close();
        resolve();
      };

      // Lets teardown cut a clip off mid-sentence. Without this, ending the
      // interview leaves the interviewer talking over the confirmation.
      stopPlaybackRef.current = finish;

      // A stalled element must never wedge the interview loop.
      const guard = setTimeout(finish, (fallbackDurationSec + 30) * 1000);

      const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
      const tick = () => {
        if (!analyser || !data || settled) return;
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((acc, v) => acc + (v - 128) ** 2, 0) / data.length) / 128;
        setAmplitude(Math.min(1, rms * 5));
        if (!audio.paused && !audio.ended) requestAnimationFrame(tick);
      };

      audio.onended = finish;
      audio.onerror = finish;

      audio
        .play()
        .then(() => tick())
        .catch((err) => {
          console.warn('[interview] playback blocked', err);
          finish();
        });
    });
  }, []);

  /** Speaks a whole turn: every clip in order, then hands the floor back. */
  const speak = useCallback(
    async (segments: Array<{ url: string }>, fallbackDurationSec: number) => {
      setPhase('speaking');

      if (segments.length === 0) {
        // Text is on screen either way — degrade texture, not the run.
        await new Promise((r) => setTimeout(r, fallbackDurationSec * 1000));
        return;
      }

      for (const segment of segments) {
        // Checked between clips as well as inside them: a turn is several
        // separate files, and aborting one must not let the next one start.
        if (aborted.current) return;
        await playClip(segment.url, fallbackDurationSec);
      }
      setAmplitude(0);
    },
    [playClip],
  );

  // ── The loop ───────────────────────────────────────────────────────────────

  const runTurn = useCallback(
    async (answerPayload: Record<string, unknown> | undefined) => {
      setPhase('thinking');

      // The question this answer was given to, captured before the turn
      // advances — /reflect needs to know what it is reflecting on.
      const answeredQuestionId = lastQuestionIdRef.current;

      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: answerPayload,
          elapsedSec: startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0,
          // Sent every turn, not just at the end: the server needs it to keep
          // time in the editor from eating the conversation's budget.
          codingSec: codingSecondsSoFar(),
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
      lastQuestionIdRef.current = data.questionId ?? null;

      /*
       * The slow lane, started here and deliberately NOT awaited.
       *
       * The turn above made no model call — it played the next prepared
       * question — so this is where the interviewer actually reads what was
       * said and decides whether to come back to it. It runs for the two or
       * three seconds the interviewer is speaking, and its result is picked up
       * by a later turn.
       *
       * Fired after /turn resolves rather than alongside it so the state it
       * reads already includes this answer.
       */
      if (answerPayload && answeredQuestionId) {
        void fetch(`/api/sessions/${sessionId}/reflect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionId: answeredQuestionId,
            transcript: answerPayload.transcript,
            wordCount: answerPayload.wordCount,
            durationSec: answerPayload.durationSec,
          }),
        }).catch(() => null);
      }

      // Closing the editor happens up front; opening it does not.
      if (data.mode !== 'coding') setChallenge(null);

      await speak(data.audio?.segments ?? [], 4);

      /*
       * The editor opens only after the handoff has been SPOKEN.
       *
       * Setting it before meant the split layout appeared while the interviewer
       * was still mid-sentence — and because the sentence that flips the section
       * is the transition into it, what the candidate saw was a coding problem
       * on screen while a voice asked something else entirely.
       */
      if (data.mode === 'coding' && data.challenge) {
        // Meter off at the same instant the problem appears — not when the
        // handoff started being spoken. The interviewer talking is conversation
        // and is charged for; reading a problem statement is not.
        pauseBillingForCoding();
        setChallenge(data.challenge as CodingChallengeView);
      }
      return data;
    },
    [sessionId, router, speak, pauseBillingForCoding, codingSecondsSoFar],
  );

  /**
   * Records one answer and transcribes it. Returns null when there was nothing
   * usable to send — better to re-ask than to hand silence to the grader.
   */
  const captureAnswer = useCallback(async (): Promise<Record<string, unknown> | null> => {
    setPhase('listening');

    const recorded = await recordAnswer();
    if (!recorded || recorded.blob.size < 1000) return null;

    setPhase('thinking');

    const form = new FormData();
    form.set('audio', new File([recorded.blob], 'answer.webm', { type: 'audio/webm' }));

    const res = await fetch(`/api/sessions/${sessionId}/transcribe`, { method: 'POST', body: form });
    const stt = await res.json();

    if (!res.ok) {
      setError(stt.error ?? 'We could not hear that clearly.');
      setPhase('failed');
      return null;
    }

    // The authoritative transcript replaces the interim one — unless it came
    // back empty, in which case whatever the browser heard is better than
    // telling someone who just spoke that we caught nothing.
    setPartial((live) =>
      stt.transcript?.trim() ? stt.transcript : live.trim() || "(we didn't catch that)",
    );

    /*
     * The speech window comes from the CLIENT, measured between the first and
     * last moment the microphone was above the silence threshold. The
     * transcriber no longer returns per-word timing, and this is a truer answer
     * duration anyway: it excludes the thinking pause before the candidate
     * started, which would otherwise drag their words-per-minute down for
     * having considered the question.
     */
    const speechMs = Math.max(0, recorded.endedAt - recorded.startedAt);
    const base = startedAt.current ?? recorded.startedAt;

    return {
      transcript: stt.transcript,
      durationSec: speechMs / 1000,
      wordCount: stt.wordCount,
      startMs: recorded.startedAt - base,
      endMs: recorded.endedAt - base,
    };
  }, [sessionId, recordAnswer]);

  /**
   * Hands the floor to the editor and waits.
   *
   * The voice loop is genuinely PAUSED here — no recording, no transcription, no
   * L1/L4 calls. Someone thinking through an algorithm is not answering a
   * question, and running the turn cycle against their silence would burn model
   * calls to produce nothing. The billing clock stops for the same stretch.
   */
  const runCodingRound = useCallback(async (): Promise<Record<string, unknown> | null> => {
    // Normally already running — runTurn stops the meter as it puts the editor
    // up. This covers re-entry, and is idempotent either way.
    pauseBillingForCoding();

    const summary = await new Promise<CodingSummary | null>((resolve) => {
      codingDoneRef.current = resolve;
    });

    // Meter back on the moment the problem leaves the screen.
    resumeBillingAfterCoding();
    codingDoneRef.current = null;
    setChallenge(null);

    if (!summary) return null;

    /*
     * The submission enters the transcript as the answer to the coding
     * question, so E4 grades the same record everything else uses. The test
     * tally is fact, not judgement — S1 turns it into the score, not this.
     */
    return {
      transcript:
        `[Submitted ${summary.language} solution — ${summary.passed}/${summary.total} tests passed]

` +
        summary.source,
      durationSec: 0,
      wordCount: summary.source.split(/\s+/).filter(Boolean).length,
      startMs: 0,
      endMs: 0,
    };
  }, [pauseBillingForCoding, resumeBillingAfterCoding]);

  /**
   * The turn loop. An explicit `while` rather than recursion: a self-referencing
   * callback captures a stale closure of everything it closes over, and after
   * twenty-five turns that is exactly the kind of bug you cannot reproduce.
   */
  const loopRunning = useRef(false);

  const runLoop = useCallback(async () => {
    if (loopRunning.current) return;
    loopRunning.current = true;
    aborted.current = false;

    try {
      let answer: Record<string, unknown> | undefined;

      // Bounded so a repeatedly-failing turn can never spin forever.
      for (let guard = 0; guard < 200; guard += 1) {
        // Checked on both sides of every await: ending the interview stops the
        // microphone tracks, and recording a stopped track throws
        // NotSupportedError rather than failing quietly.
        if (aborted.current) return;

        const next = await runTurn(answer);
        if (!next || aborted.current) return; // finished, aborted, or already surfaced

        // A coding section replaces listening with the editor.
        answer =
          (next.mode === 'coding' && next.challenge
            ? await runCodingRound()
            : await captureAnswer()) ?? undefined;
      }
    } finally {
      loopRunning.current = false;
    }
  }, [runTurn, captureAnswer, runCodingRound]);

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

  /**
   * Stops everything this page owns: the turn loop, playback, the recorder, and
   * the microphone.
   *
   * Shared by the End button and by unmount. The loop is a plain async
   * function, not tied to React's lifecycle — navigating away does not stop it,
   * so without this it keeps playing audio and firing turns from a page nobody
   * is looking at.
   */
  const teardown = useCallback(() => {
    aborted.current = true;

    /*
     * Bank the open coding segment HERE, synchronously.
     *
     * Resolving the coding promise below lets `runCodingRound` bank it too, but
     * that continuation is a microtask — and `endInterview` builds its request
     * body synchronously the moment this function returns. The body was
     * therefore serialised before the banking ran, so ending an interview with
     * the editor open reported zero coding seconds and every minute spent on the
     * problem was billed as conversation at 5 credits a minute.
     *
     * `resumeBillingAfterCoding` is idempotent, so the later call is a no-op.
     */
    resumeBillingAfterCoding();

    // Release a loop parked on the coding promise, or it never returns.
    codingDoneRef.current?.(null as unknown as CodingSummary);
    stopPlaybackRef.current?.();
    liveTranscriptRef.current?.stop();
    liveTranscriptRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    try {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    } catch {
      /* already stopped */
    }

    audioElRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setAmplitude(0);
  }, [resumeBillingAfterCoding]);

  const endInterview = useCallback(async () => {
    teardown();
    // Show the change immediately. The settlement call below takes a moment,
    // and a dead-looking button is how people end up clicking twice.
    setPhase('ended');

    await fetch(`/api/sessions/${sessionId}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `endNow` ends the interview through the same path a natural finish
      // takes. The real elapsed time still goes with it — it is what the
      // candidate is billed for.
      body: JSON.stringify({
        endNow: true,
        elapsedSec: startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0,
        codingSec: codingSecondsSoFar(),
      }),
    }).catch(() => null);

    router.replace(`/sessions/${sessionId}/processing`);
  }, [sessionId, router, teardown, codingSecondsSoFar]);

  // Leaving the page by any route — back button, a redirect, a crash elsewhere —
  // must stop the loop too.
  useEffect(() => teardown, [teardown]);

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
          {/* Driven by sessions.progress over realtime. It was previously
              hardcoded, which made a slow-but-healthy prep look identical to a
              hang — the worst possible thing for a screen whose only job is to
              tell you something is happening. */}
          <StageList stages={SESSION_PREP_STAGES.map((s) => s.label)} current={prepStage} />
          <p className="mt-5 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55">
            {prepDetail ?? 'Writing the questions takes the longest — usually under a minute.'}
          </p>
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

  if (phase === 'ended') {
    return (
      <Shell>
        <Card className="p-8 max-w-md w-full text-center">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold mb-2">
            Wrapping up…
          </h1>
          <p className="text-sm text-[#1B1F3B]/70">
            Working out what you used and starting your report.
          </p>
        </Card>
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

  /*
   * Coding mode takes over the whole screen — the split layout needs the width,
   * and the conversational shell has nothing useful to add next to an editor.
   * The interviewer survives as a rail inside it, because thinking out loud is
   * still part of what gets graded.
   */
  if (challenge) {
    return (
      <CodingMode
        sessionId={sessionId}
        challenge={challenge}
        elapsedLabel={formatTime(elapsed)}
        waveform={<Waveform phase={phase} amplitude={amplitude} />}
        // What the interviewer just said out loud. Shown as text too — the
        // candidate is about to look away from the rail for ten minutes.
        interviewerLine={question}
        getDraft={getCodeDraft}
        onDraftChange={saveCodeDraft}
        onSubmitted={(summary) => codingDoneRef.current?.(summary)}
      />
    );
  }

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

          {/* Your own words as you say them — makes mistranscription visible
              while there is still time to say it differently. */}
          {partial && (
            <div className="mt-8 p-4 bg-white border-4 border-[#1B1F3B] rounded-3xl max-h-40 overflow-y-auto">
              <p className="text-sm text-[#1B1F3B]/80 leading-relaxed">
                {partial}
                {phase === 'listening' && (
                  <span className="inline-block w-1.5 h-4 ml-1 -mb-0.5 bg-[#1B1F3B] animate-pulse" />
                )}
              </p>
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
