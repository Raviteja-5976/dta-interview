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
import SkillMode, {
  type SkillChallengeView,
  type SkillDraft,
  type SkillSummary,
} from '@/components/app/SkillMode';
import { SESSION_PREP_STAGES } from '@/lib/pipelines/prep-stages';
import { openLiveStt, type LiveSttResult, type LiveSttSession } from '@/lib/speech/deepgram-live';
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
 * End-of-utterance, FALLBACK ONLY: silence for this long after speech has
 * started ends the answer.
 *
 * Deepgram's `UtteranceEnd` is the primary signal now, and it is a better one
 * for the reason §12 gives — an amplitude threshold cannot tell a candidate
 * thinking mid-sentence from one who has finished, because both are quiet. This
 * rule applies only when the live socket could not be opened.
 *
 * Deliberately generous either way. People pause mid-answer — to recall a
 * detail, to decide how to phrase something — and cutting in after a second and
 * a half of that reads as being interrupted, which is exactly what makes a
 * voice agent feel unnatural.
 */
const SILENCE_MS = 2_500;

/**
 * Below this RMS counts as silence.
 *
 * Still read on every frame, because it drives the waveform and marks the
 * speech window E2 measures pace against. It only decides the END of a turn on
 * the fallback path.
 */
const SILENCE_THRESHOLD = 0.02;

/** Never cut someone off before they have really started. */
const MIN_ANSWER_MS = 1_200;

/**
 * The hard ceiling on a single answer, enforced on a timer.
 *
 * Well past any real interview answer — this is not a pacing rule, it is the
 * backstop for the frame loop not running at all (a hidden tab, a throttled
 * background window). Reaching it means something else went wrong, and ending
 * the answer with whatever was captured beats waiting forever.
 */
const MAX_ANSWER_MS = 4 * 60 * 1_000;

/**
 * How long to wait for the candidate to begin at all.
 *
 * sitemap §9: eight seconds of quiet is a thinking pause, not a finished
 * answer. Waiting past that hands back so the interviewer can prompt.
 */
const WAIT_FOR_SPEECH_MS = 12_000;

/**
 * Below this many bytes in a whole answer window, the microphone is dead.
 *
 * Not a silence threshold — a liveness one. Opus encodes a silent room at
 * roughly 1–2 KB per second, so any window in which someone merely said nothing
 * still lands in the tens of kilobytes. Coming out of one under a couple of KB
 * means no samples arrived at all, which is a broken capture path and not
 * something the interviewer should paper over by re-asking the question.
 */
const MIN_LIVE_AUDIO_BYTES = 2_048;

/**
 * The container to record in, preferred rather than left to the browser.
 *
 * Deepgram detects the container from the first bytes on the socket, so the
 * recorder and the fallback upload must agree on what it is. Chrome and Firefox
 * give WebM/Opus; Safari only does MP4/AAC, which the batch route was
 * mislabelling as WebM. Returning undefined lets the browser pick, which is the
 * right answer when none of these are supported.
 */
function preferredRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

interface CodingSummary {
  passed: number;
  total: number;
  language: string;
  source: string;
}

interface RecordedAnswer {
  blob: Blob;
  /** What the recorder actually produced, so the batch route is told the truth. */
  mimeType: string;
  /** Bytes captured. Under `MIN_LIVE_AUDIO_BYTES` the microphone is dead. */
  bytes: number;
  /** Either the amplitude rule or Deepgram believed the candidate spoke. */
  speechDetected: boolean;
  /**
   * The live socket was open and healthy for this answer.
   *
   * False means it never opened or died mid-answer — the case the recording is
   * kept for, and the one where an empty transcript proves nothing.
   */
  liveSttUsable: boolean;
  /** When speech actually began — not when the recorder did. */
  startedAt: number;
  endedAt: number;
  /**
   * What the live socket heard, when it was open.
   *
   * Present on the ordinary path, and it is the whole point of streaming: the
   * transcript and its word timings are already here the moment the candidate
   * stops talking. Null means the socket never opened and the clip has to go to
   * the batch route instead.
   */
  live: LiveSttResult | null;
}

export default function LiveInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [question, setQuestion] = useState('');
  /*
   * What the current question is trying to establish.
   *
   * Arrives on the same `/turn` response as the question itself — it is a
   * lookup the turn already performed, not a second request — so showing it
   * costs nothing in the silence the candidate is waiting through.
   */
  const [questionGoal, setQuestionGoal] = useState<{
    statement: string;
    pursuing: string[];
  } | null>(null);
  const [sectionTitle, setSectionTitle] = useState('');
  const [progress, setProgress] = useState({ sectionsTotal: 0, sectionsCompleted: 0 });
  const [partial, setPartial] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  /*
   * Mirrors `muted` for code that runs outside render — `acquireMicrophone`
   * re-applies it to a freshly opened track, and a candidate who muted
   * themselves must not come back unmuted because their headset reconnected.
   */
  const mutedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const [prepStage, setPrepStage] = useState(0);
  const [prepDetail, setPrepDetail] = useState<string | null>(null);
  /** Non-null while the candidate is in the coding editor. */
  const [challenge, setChallenge] = useState<CodingChallengeView | null>(null);
  /** Non-null while the candidate is in the skill-challenge editor. */
  const [skillChallenge, setSkillChallenge] = useState<SkillChallengeView | null>(null);

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
  const micCtxRef = useRef<AudioContext | null>(null);
  /** The Deepgram socket, open only while an answer is in flight. */
  const liveSttRef = useRef<LiveSttSession | null>(null);
  /**
   * A Deepgram token and the moment it stops working.
   *
   * Cached because minting one is a round trip to our server and then to
   * Deepgram, and doing that between the question ending and the microphone
   * opening would put it right inside the pause the candidate experiences as
   * the interviewer waiting for them. One token covers several answers.
   */
  const voiceTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);
  /** Session language, for the STT socket. Read once the session loads. */
  const languageRef = useRef<string>('en-IN');
  /** Deepgram heard speech begin, in wall-clock terms. */
  const dgSpeechStartedRef = useRef<number | null>(null);
  /**
   * Deepgram's end-of-utterance signal for the answer in flight.
   *
   * Set when Deepgram thinks they have finished and CLEARED again the moment
   * another word arrives, because an end-of-utterance is only ever a guess.
   * A latching flag here is a real bug rather than a cosmetic one: the grace
   * window below suppresses the stop decision for the first few seconds, so a
   * flag set during it survives to fire the instant the window expires — and
   * cuts off a candidate who opened with "Um, okay —", thought for a moment,
   * and is now mid-answer.
   */
  const dgUtteranceEndedRef = useRef(false);
  /** The socket died mid-answer; fall back to the amplitude rule. */
  const dgFailedRef = useRef(false);
  /**
   * The last answer window captured no audio at all.
   *
   * Distinct from "the candidate said nothing", which is an ordinary thing that
   * happens in interviews and is handled by re-asking. This means the capture
   * path is broken, and re-asking cannot fix it — see `captureAnswer`.
   */
  const micDeadRef = useRef(false);
  /*
   * Set when the answer window could not be opened AT ALL — no live track, or
   * MediaRecorder refused to start.
   *
   * `recordAnswer` returns null for that and for a candidate who simply said
   * nothing, and the caller used to treat both as silence: it handed back
   * `undefined`, the interviewer asked the next question, and the loop raced
   * through the whole plan without ever waiting for an answer. That is the
   * "it isn't waiting for me to answer" symptom, and this flag is what tells
   * the two apart.
   */
  const micUnavailableRef = useRef(false);
  /** Consecutive answer windows that captured nothing. */
  const micDeadStreak = useRef(0);
  /** The question currently on screen. */
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

  /** The skill round's twin of the two above. Same reasoning, separate store. */
  const skillDoneRef = useRef<((summary: SkillSummary | null) => void) | null>(null);
  const skillDrafts = useRef<Record<number, SkillDraft>>({});

  const getSkillDraft = useCallback((index: number) => skillDrafts.current[index], []);
  const saveSkillDraft = useCallback((index: number, draft: SkillDraft) => {
    skillDrafts.current[index] = draft;
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
      .select('id, status, config')
      .eq('id', sessionId)
      .maybeSingle();

    if (!data) {
      setError('We could not find that interview.');
      setPhase('failed');
      return;
    }

    // The STT socket needs this, and it is opened from a callback that cannot
    // wait on a query.
    const config = data.config as { language?: string } | null;
    if (config?.language) languageRef.current = config.language;

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

  /**
   * The page's ONE AudioContext, for the microphone analyser and for playback.
   *
   * It used to be one per clip — `playClip` constructed a context, wired the
   * <audio> element into it, and closed it again when the clip ended — plus a
   * separate permanent one for the microphone. That is what silenced the
   * interview.
   *
   * Opening and closing a context reconfigures the browser's audio device, and
   * on Windows that reconfiguration lands on the CAPTURE side too: the
   * getUserMedia track keeps `readyState === 'live'` and reports no error, but
   * stops delivering samples. So the first question played (context opened,
   * then closed), and every recording after it read a dead microphone —
   * MediaRecorder emitted zero-length chunks, the analyser read a flat line, and
   * Deepgram received no audio. Every layer agreed there was silence, because
   * from the page's point of view there genuinely was.
   *
   * One context, opened once and never closed while the interview runs, removes
   * the churn. It also keeps us clear of Chrome's hard limit of six contexts per
   * document, which the per-clip version was spending one of on every turn.
   */
  const audioContext = useCallback(async (): Promise<AudioContext | null> => {
    let ctx = micCtxRef.current;

    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new AudioContext();
        micCtxRef.current = ctx;
      } catch (err) {
        console.warn('[interview] AudioContext unavailable', err);
        return null;
      }
    }

    /*
     * Created outside a user gesture it starts suspended, and a suspended
     * context both plays nothing and analyses nothing.
     *
     * Raced against a deadline because `resume()` on a context the browser is
     * still refusing to start does not reject — it returns a promise that stays
     * pending until a gesture that may never come. Awaiting that directly is
     * enough to stall the whole turn loop, so the deadline hands back an
     * unresumed context instead and the caller carries on without the waveform.
     */
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume().catch(() => null),
        new Promise((r) => setTimeout(r, 1_000)),
      ]);
    }
    return ctx;
  }, []);

  const attachAnalyser = useCallback(
    async (stream: MediaStream) => {
      try {
        const ctx = await audioContext();
        if (!ctx) return;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;
      } catch (err) {
        // Cosmetic only — the waveform goes flat and the RMS fallback is lost,
        // but recording and Deepgram are both unaffected. Never fatal.
        console.warn('[interview] failed to attach mic analyser', err);
      }
    },
    [audioContext],
  );

  /**
   * Opens the microphone and wires up everything that watches it.
   *
   * Split out of `begin` because it is now needed twice: once to start, and
   * again to RECOVER. A `MediaStreamTrack` ends for reasons that have nothing
   * to do with the interview — a Bluetooth headset connecting or dropping, the
   * OS default input changing, a USB device re-enumerating, Windows handing the
   * device to another application — and an ended track never comes back. It is
   * dead for the rest of the session, `MediaRecorder` yields zero bytes on it,
   * and there was no path from there back to a working microphone.
   */
  const acquireMicrophone = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Without these the interviewer's own voice comes back through the
        // speakers and Deepgram transcribes the questions as answers.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Whatever was there before is finished with. Left running it holds the
    // device open, which on Windows is itself enough to make the new capture
    // fail.
    const previous = streamRef.current;
    if (previous && previous !== stream) {
      previous.getTracks().forEach((t) => t.stop());
    }

    streamRef.current = stream;
    // Muting is a UI toggle and must survive re-acquisition, or a candidate who
    // muted themselves comes back unmuted without touching anything.
    stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));

    /*
     * Awaited. It was not, and `attachAnalyser` is async, so the first answer
     * could reach `recordAnswer` before `analyserRef` was populated — and
     * `recordAnswer` then returned null without recording anything at all.
     */
    await attachAnalyser(stream);

    /*
     * A track that arrives already muted is a device held by something else,
     * or muted at the OS level. It reports `readyState: 'live'` throughout, so
     * nothing downstream can tell it apart from a quiet room; this is the only
     * place the difference is visible.
     */
    const track = stream.getAudioTracks()[0];
    console.info(
      `[interview] microphone open: "${track?.label || 'unknown device'}" ` +
        `(muted=${track?.muted ?? 'n/a'}, state=${track?.readyState ?? 'n/a'})`,
    );
    if (track?.muted) {
      console.warn('[interview] microphone track is muted at the source');
    }
    track?.addEventListener('mute', () => {
      console.warn('[interview] microphone track went silent mid-interview');
    });
    track?.addEventListener('unmute', () => {
      console.info('[interview] microphone track came back');
    });
    track?.addEventListener('ended', () => {
      // Not fatal any more. `ensureMicrophone` re-opens the device before the
      // next answer window, so this is a note about the hardware rather than
      // the end of the interview.
      console.warn('[interview] microphone track ended — will re-acquire before the next answer');
    });

    return stream;
  }, [attachAnalyser]);

  /**
   * The live audio track, re-opening the device if the old one died.
   *
   * Called at the top of every answer window. In the ordinary case it is a
   * property read and costs nothing; when the track has ended it is one
   * `getUserMedia` — the permission is already granted, so there is no prompt
   * and no gesture requirement.
   */
  const ensureMicrophone = useCallback(async (): Promise<MediaStreamTrack | null> => {
    const live = streamRef.current?.getAudioTracks().find((t) => t.readyState === 'live');
    if (live) return live;

    if (aborted.current) return null;

    console.warn('[interview] no live audio track — re-acquiring the microphone');
    try {
      const stream = await acquireMicrophone();
      return stream.getAudioTracks().find((t) => t.readyState === 'live') ?? null;
    } catch (err) {
      console.error('[interview] could not re-acquire the microphone', err);
      return null;
    }
  }, [acquireMicrophone]);

  /**
   * A Deepgram token, minted on demand and reused until it is nearly expired.
   *
   * Returns null on any failure, which is not fatal: the answer is recorded and
   * transcribed in batch instead. Invariant 12 — degrade texture, never
   * terminate.
   */
  const voiceToken = useCallback(async (): Promise<string | null> => {
    const cached = voiceTokenRef.current;
    // Thirty seconds of headroom, so a token cannot expire between this check
    // and the socket handshake that uses it.
    if (cached && cached.expiresAt - Date.now() > 30_000) return cached.token;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/voice-token`, { method: 'POST' });
      if (!res.ok) return null;

      const body = (await res.json()) as { accessToken?: string; expiresIn?: number };
      if (!body.accessToken) return null;

      voiceTokenRef.current = {
        token: body.accessToken,
        expiresAt: Date.now() + (body.expiresIn ?? 300) * 1000,
      };
      return body.accessToken;
    } catch {
      return null;
    }
  }, [sessionId]);

  /**
   * Records one answer, streaming it to Deepgram as it is spoken.
   *
   * ── What ends the turn ───────────────────────────────────────────────────
   * Deepgram's `UtteranceEnd`, which is derived from gaps between recognised
   * WORDS. This used to be an RMS threshold over the microphone, and the
   * difference is the one §12 calls the primary risk of a cascaded voice stack:
   * an energy threshold cannot tell a candidate thinking mid-sentence from one
   * who has finished, because both are quiet. A pause with breathing, keyboard
   * noise, or a trailing "um" in it is not silence to Deepgram.
   *
   * The floors below still apply on top, because they encode interview manners
   * rather than acoustics — the grace window before any stop decision is taken,
   * the minimum answer length, and the point at which we hand back so the
   * interviewer can prompt someone who has not spoken at all.
   *
   * The RMS reading stays, but only to drive the waveform. When the socket
   * cannot be opened it becomes the end-of-turn signal again, exactly as before.
   */
  const recordAnswer = useCallback(async (): Promise<RecordedAnswer | null> => {
    /*
     * A stopped track cannot be recorded: MediaRecorder.start() throws
     * NotSupportedError rather than failing gracefully.
     *
     * This used to return null on the spot, which conflated two situations the
     * caller then treated identically — the interview ending while the loop was
     * mid-flight, and the capture device having died under us. The second is
     * recoverable and now is: `ensureMicrophone` re-opens the device, and only
     * a genuine failure to get one falls through.
     */
    const track = await ensureMicrophone();
    const stream = streamRef.current;
    if (!stream || !track) {
      // Distinguishable from "the candidate said nothing", which is also null.
      micUnavailableRef.current = true;
      return null;
    }
    micUnavailableRef.current = false;

    /*
     * The analyser is NOT a precondition.
     *
     * It used to be — `if (!stream || !analyser || !trackLive) return null` —
     * which made a cosmetic component load-bearing: `attachAnalyser` is async
     * and `begin` did not await it, so an answer recorded before it resolved was
     * thrown away without a single byte being captured, and the interviewer
     * simply re-asked. The analyser drives the waveform and the RMS fallback;
     * neither is worth losing an answer over.
     */
    const analyser = analyserRef.current;

    // Suspended contexts analyse nothing, so the waveform and the RMS
    // end-of-turn rule both go dead. Resuming is cheap and usually a no-op.
    await audioContext();

    dgSpeechStartedRef.current = null;
    dgUtteranceEndedRef.current = false;
    dgFailedRef.current = false;

    const token = await voiceToken();
    const stt = token
      ? await openLiveStt({
          token,
          language: languageRef.current,
          onInterim: (text) => {
            if (text.trim()) {
              dgSpeechStartedRef.current ??= Date.now();
            }
            setPartial(text);
          },
          // Deepgram heard speech begin. More reliable than the amplitude
          // threshold, which also trips on a door closing.
          onSpeechStarted: () => {
            dgSpeechStartedRef.current ??= Date.now();
          },
          onUtteranceEnd: () => {
            dgUtteranceEndedRef.current = true;
          },
          // They are still talking, so any pending end-of-utterance was a
          // guess that has just been proven wrong. See the note on the flag.
          onSpeech: () => {
            dgSpeechStartedRef.current ??= Date.now();
            dgUtteranceEndedRef.current = false;
          },
          onFailure: (reason) => {
            console.warn('[interview] live STT failed:', reason);
            // Fall back to the RMS rule for the remainder of this answer.
            dgFailedRef.current = true;
          },
        })
      : null;

    liveSttRef.current = stt;

    /*
     * The recorder's own container type, asked for explicitly.
     *
     * Deepgram sniffs the container from the first frame on the socket, and the
     * batch route is told what it is being sent. Letting the browser pick
     * silently meant Safari handed both of them `audio/mp4` while the fallback
     * upload claimed `audio/webm`.
     */
    const mimeType = preferredRecorderMime();

    const recorded = await new Promise<Omit<RecordedAnswer, 'live'> | null>((resolve) => {
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (err) {
        console.error('[interview] MediaRecorder could not be created', err);
        micUnavailableRef.current = true;
        return resolve(null);
      }

      chunksRef.current = [];
      recorderRef.current = recorder;
      answerStartRef.current = Date.now();

      let speechStartedAt: number | null = null;
      let speechEndedAt: number | null = null;
      let silenceSince: number | null = null;
      /** Bytes the recorder has actually produced. See the mic-health check. */
      let bytes = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        bytes += e.data.size;
        /*
         * Both destinations, every chunk.
         *
         * The socket is the fast path and the clip is the insurance: if the
         * socket dies halfway through an answer, the recording is complete and
         * the batch route can still recover what was said. Keeping the blob
         * costs memory for the length of one answer and nothing else.
         */
        chunksRef.current.push(e.data);
        stt?.sendAudio(e.data);
      };

      // MediaRecorder reports its own failures here, and they used to go
      // nowhere: the recording simply stopped and the answer vanished.
      recorder.onerror = (e) => {
        console.error('[interview] MediaRecorder error', (e as ErrorEvent).error ?? e);
      };

      recorder.onstop = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setAmplitude(0);

        /*
         * A recorder that produced essentially nothing is a DEAD MICROPHONE,
         * not a quiet candidate.
         *
         * Even a silent room yields kilobytes of Opus per second, so the only
         * way to come out of a twelve-second window under a kilobyte is for the
         * track to have delivered no samples at all — the device muted at the OS
         * level, another application holding it exclusively, or the capture side
         * knocked over by an audio-device reconfiguration.
         *
         * This used to resolve null here, indistinguishable from silence, so the
         * interviewer just re-asked the question and the interview ran to its
         * end having recorded nothing. It is reported now.
         */
        micDeadRef.current = bytes < MIN_LIVE_AUDIO_BYTES;

        const effectiveStart = speechStartedAt ?? dgSpeechStartedRef.current ?? answerStartRef.current;
        resolve({
          blob: new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' }),
          mimeType: recorder.mimeType || mimeType || 'audio/webm',
          bytes,
          speechDetected: speechStartedAt !== null || dgSpeechStartedRef.current !== null,
          liveSttUsable: Boolean(stt) && !dgFailedRef.current,
          startedAt: effectiveStart,
          endedAt: speechEndedAt ?? Date.now(),
        });
      };

      try {
        // 250ms slices. Small enough that Deepgram is transcribing continuously
        // rather than in visible jumps, large enough not to flood the socket.
        recorder.start(250);
      } catch (err) {
        console.error('[interview] MediaRecorder could not be started', err);
        micUnavailableRef.current = true;
        return resolve(null);
      }

      /*
       * The hard ceiling on one answer, on a timer rather than a frame callback.
       *
       * Every rule below runs inside `requestAnimationFrame`, which browsers
       * stop delivering to a hidden tab. A candidate who switches windows
       * mid-answer therefore froze the turn: the recorder kept running, no stop
       * rule could ever fire, and the loop waited on a promise nothing would
       * resolve. A timer keeps ticking while hidden, so the answer always ends.
       */
      const hardStop = setTimeout(
        () => {
          if (recorder.state === 'recording') {
            console.warn('[interview] answer hit the hard ceiling; stopping the recorder');
            recorder.stop();
          }
        },
        MAX_ANSWER_MS,
      );
      recorder.addEventListener('stop', () => clearTimeout(hardStop), { once: true });

      const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

      const tick = () => {
        if (recorder.state !== 'recording') return;

        /*
         * No analyser means no amplitude reading, and that is survivable: the
         * waveform sits flat and `speaking` is decided by Deepgram alone. What
         * must not happen is the turn ending because a cosmetic node is missing.
         */
        let rms = 0;
        if (analyser && data) {
          analyser.getByteTimeDomainData(data);
          rms = Math.sqrt(data.reduce((acc, v) => acc + (v - 128) ** 2, 0) / data.length) / 128;
        }

        setAmplitude(Math.min(1, rms * 6));

        const now = Date.now();
        const speaking = rms >= SILENCE_THRESHOLD;
        const sinceQuestion = now - answerStartRef.current;
        const streaming = Boolean(stt) && !dgFailedRef.current;

        // The speech window E2 uses for pace. Tracked from the microphone
        // either way — Deepgram's word times are relative to the socket, and
        // this is the clock the rest of the turn is measured on.
        if (speaking) {
          speechStartedAt ??= now;
          speechEndedAt = now;
          silenceSince = null;
        } else {
          silenceSince ??= now;
        }

        // Deepgram may have heard speech the amplitude threshold missed —
        // someone softly spoken, or a distant microphone.
        if (dgSpeechStartedRef.current !== null) {
          speechStartedAt ??= dgSpeechStartedRef.current;
          speechEndedAt = now;
          silenceSince = null;
        }

        // The grace floor. No stop decision of any kind before it elapses, so a
        // candidate who takes a moment to gather their thoughts is never cut off
        // before they have begun.
        if (sinceQuestion < RESPONSE_GRACE_MS) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        if (speechStartedAt !== null) {
          const longEnough = now - speechStartedAt > MIN_ANSWER_MS;

          // Primary: Deepgram says the utterance ended.
          if (streaming && dgUtteranceEndedRef.current && longEnough) {
            recorder.stop();
            return;
          }

          // Fallback: the old amplitude rule, for when the socket is not there.
          if (
            !streaming &&
            silenceSince !== null &&
            now - silenceSince > SILENCE_MS &&
            longEnough
          ) {
            recorder.stop();
            return;
          }
        } else if (sinceQuestion > WAIT_FOR_SPEECH_MS) {
          // Still nothing. Hand back so the interviewer can prompt, rather than
          // posting silence to the transcriber.
          recorder.stop();
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    });

    /*
     * Close the socket even when nothing was recorded — an abandoned answer
     * still leaves an open WebSocket, and a session's worth of those is a leak
     * the candidate pays for in dropped connections later.
     */
    if (!recorded) {
      stt?.abort();
      liveSttRef.current = null;
      return null;
    }

    const live = stt ? await stt.finish() : null;
    liveSttRef.current = null;

    return { ...recorded, live: live?.transcript ? live : null };
  }, [voiceToken, audioContext, ensureMicrophone]);

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

    /*
     * The analyser is what makes the waveform honest (sitemap §9), but it is
     * also the part that can fail. If wiring it up throws — CORS refused, or
     * the element is already attached to another context — fall back to plain
     * playback. A flat waveform is a cosmetic loss; silence is not.
     *
     * The context is the PAGE's, borrowed for this clip and left open
     * afterwards. It used to be built and closed per clip, which reconfigured
     * the audio device between every question and answer and took the
     * microphone down with it. Nothing here closes it now; `teardown` owns its
     * lifetime.
     */
    const ctx = await audioContext();
    let source: MediaElementAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;

    if (ctx) {
      try {
        source = ctx.createMediaElementSource(audio);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
      } catch (err) {
        console.warn('[interview] could not wire clip into the audio graph', err);
        /*
         * Once `createMediaElementSource` has succeeded the element no longer
         * reaches the speakers on its own — its output belongs to the graph. So
         * a failure AFTER that point must reconnect it to the destination
         * directly, or the clip plays to nowhere and the interviewer is mute.
         */
        try {
          source?.connect(ctx.destination);
        } catch {
          /* nothing more to try; the element is on its own */
        }
        analyser = null;
      }
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
        /*
         * Unhook this clip's nodes but leave the context running. A
         * MediaElementAudioSourceNode stays bound to its element for that
         * element's lifetime, so the only cleanup available — and the only one
         * needed, since the element is discarded with the clip — is dropping it
         * out of the graph.
         */
        try {
          source?.disconnect();
          analyser?.disconnect();
        } catch {
          /* already detached */
        }
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
          /*
           * Every failure here resolves the promise, including AbortError.
           *
           * AbortError means the clip was interrupted by a pause or a new src —
           * which is expected — but returning without calling `finish()` left
           * the promise pending forever, and `speak` awaits it, and the turn
           * loop awaits `speak`. One interrupted clip wedged the whole
           * interview with no error anywhere.
           */
          if ((err as Error)?.name !== 'AbortError') {
            console.warn('[interview] playback blocked', err);
          }
          finish();
        });
    });
  }, [audioContext]);

  /** Speaks a whole turn: every clip in order, then hands the floor back. */
  const speak = useCallback(
    async (segments: Array<{ url: string }>, fallbackDurationSec: number) => {
      // Pre-warm the voice token in background while the interviewer is speaking
      void voiceToken();

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
    [playClip, voiceToken],
  );

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
      setQuestionGoal(
        data.goal?.statement
          ? { statement: data.goal.statement, pursuing: data.goal.pursuing ?? [] }
          : null,
      );
      setSectionTitle(data.section?.title ?? '');
      setProgress(data.progress ?? { sectionsTotal: 0, sectionsCompleted: 0 });
      setPartial('');
      lastQuestionIdRef.current = data.questionId ?? null;

      /*
       * No second request any more.
       *
       * `/turn` used to be followed by a `/reflect` call that read the answer
       * properly and queued a probe for a later turn, because the turn itself
       * had no latency budget to write one. The interviewer now decides and
       * writes inside the turn, so the follow-up it wants to ask is the
       * question it just asked.
       */

      // Closing an editor happens up front; opening one does not.
      if (data.mode !== 'coding') setChallenge(null);
      if (data.mode !== 'skill_challenge') setSkillChallenge(null);

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

      // The skill round follows the same rule for the same reason: reading a
      // schema or unfamiliar broken code is not conversation and is not billed.
      if (data.mode === 'skill_challenge' && data.skillChallenge) {
        pauseBillingForCoding();
        setSkillChallenge(data.skillChallenge as SkillChallengeView);
      }
      return data;
    },
    [sessionId, router, speak, pauseBillingForCoding, codingSecondsSoFar],
  );

  /**
   * Records one answer and transcribes it. Returns null when there was nothing
   * usable to send — better to re-ask than to hand silence to the grader.
   *
   * ── Re-asking is only the right answer for SILENCE ──────────────────────────
   * This used to return null for three quite different situations and treat them
   * identically: the candidate said nothing, the recorder produced nothing, and
   * the live socket produced nothing. Only the first is a candidate who needs
   * prompting. The other two are faults, and re-asking a broken microphone just
   * runs the interview to its end recording no answers at all — which is exactly
   * what happened, three sessions in a row, each ending on "No answers were
   * recorded in this session."
   */
  /**
   * Stops the interview once the microphone has failed twice running.
   *
   * Two strikes rather than one because the first is often recoverable — a
   * device switch, a headset reconnecting — and `captureAnswer` re-opens the
   * device between them. A second failure after a fresh `getUserMedia` is a
   * capture path that is genuinely broken, and continuing would produce an
   * interview with no answers in it.
   */
  const failCaptureIfExhausted = useCallback(() => {
    if (micDeadStreak.current < 2) return;
    setError(
      'We are not receiving any audio from your microphone. Check that the right input ' +
        'device is selected and that no other app (Zoom, Teams, Discord) is holding it, ' +
        'then reload to restart the interview.',
    );
    setPhase('failed');
    aborted.current = true;
  }, []);

  const captureAnswer = useCallback(async (): Promise<Record<string, unknown> | null> => {
    setPhase('listening');

    const recorded = await recordAnswer();

    /*
     * A window that could not be OPENED is a fault, not a quiet candidate.
     *
     * Returning null here without saying anything is what let the loop sprint:
     * `captureAnswer` handed back undefined, `runTurn` was called with no
     * answer, the interviewer asked the next question, and the whole plan went
     * past in seconds with nothing recorded. It counts against the strike
     * budget like a dead window, because that is what it is.
     */
    if (!recorded) {
      if (!micUnavailableRef.current || aborted.current) return null;

      micDeadStreak.current += 1;
      console.error(
        `[interview] could not open an answer window — no usable microphone ` +
          `(streak ${micDeadStreak.current}).`,
      );
      failCaptureIfExhausted();
      return null;
    }

    /*
     * Nothing came off the microphone. Say so, and stop after the second one
     * rather than conducting an entire interview into a dead input.
     */
    if (micDeadRef.current || recorded.bytes < MIN_LIVE_AUDIO_BYTES) {
      micDeadStreak.current += 1;
      console.error(
        `[interview] microphone produced ${recorded.bytes} bytes in this answer window ` +
          `(streak ${micDeadStreak.current}). Expected tens of kilobytes even in silence.`,
      );

      /*
       * One repair attempt before giving up on the device.
       *
       * A track that has ended stays ended, so the second window would produce
       * zero bytes exactly like the first and the interview would fail on a
       * fault that re-opening the device fixes. Costs one `getUserMedia` on a
       * permission that is already granted.
       */
      if (micDeadStreak.current === 1 && !aborted.current) {
        console.warn('[interview] re-opening the microphone after a dead answer window');
        await acquireMicrophone().catch((err) => {
          console.error('[interview] microphone re-open failed', err);
        });
      }

      failCaptureIfExhausted();
      return null;
    }

    micDeadStreak.current = 0;
    console.info(
      `[interview] answer captured: ${(recorded.bytes / 1024).toFixed(0)} KB, ` +
        `speech=${recorded.speechDetected}, liveSTT=${recorded.liveSttUsable}, ` +
        `transcript="${(recorded.live?.transcript ?? '').slice(0, 60)}"`,
    );
    setPhase('thinking');

    /*
     * ── The ordinary path costs nothing ──────────────────────────────────────
     *
     * The socket transcribed the answer while it was being spoken, so there is
     * no transcription step here at all — no upload, no round trip, no model
     * call. The whole of what used to sit in the silence after an answer is
     * already done by the time the candidate stops talking.
     *
     * The word timings arrive with it, from the same pass (invariant 16), which
     * is what gives E2 back its pause profile.
     */
    let transcript = recorded.live?.transcript ?? '';
    let words = recorded.live?.words ?? [];
    let asrConfidence = recorded.live?.confidenceAvg;

    if (!transcript) {
      /*
       * ── When an empty live transcript is worth a second opinion ────────────
       *
       * A healthy socket that heard nothing while nothing was detected on the
       * microphone either is simply a candidate who did not speak. That is an
       * ordinary interview event, the interviewer prompts, and paying for a
       * batch pass over a clip of silence would buy the same empty string.
       *
       * Anything else — the socket never opened, it died mid-answer, or speech
       * WAS detected and the socket still came back empty — is a fault, and the
       * recording exists precisely so the answer survives it.
       */
      if (recorded.liveSttUsable && !recorded.speechDetected) {
        setPartial('');
        return null;
      }

      /*
       * This is the path that never ran. The 1000-byte floor above it returned
       * null before reaching here, so a failed socket meant a lost answer rather
       * than a slower one — the entire point of keeping the recording.
       */
      console.warn('[interview] live STT returned nothing; recovering via batch transcription');

      const ext = recorded.mimeType.includes('mp4') ? 'mp4' : recorded.mimeType.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      // The recorder's real type, not an assumed one: Deepgram is told what it
      // is actually being handed instead of being left to fail on a mislabel.
      form.set('audio', new File([recorded.blob], `answer.${ext}`, { type: recorded.mimeType }));

      const res = await fetch(`/api/sessions/${sessionId}/transcribe`, { method: 'POST', body: form });
      const stt = await res.json().catch(() => ({}) as { transcript?: string; error?: string });

      if (!res.ok) {
        // Not fatal on its own — one lost answer beats a dead interview, and
        // the interviewer will follow up. Only a repeated failure ends the run.
        console.error('[interview] batch transcription failed', res.status, stt?.error);
        setError(stt?.error ?? 'We could not hear that clearly.');
        setPhase('failed');
        return null;
      }

      transcript = stt.transcript ?? '';
      words = stt.words ?? [];
      asrConfidence = undefined;
    }

    /*
     * Audio was captured but nothing was recognised in it — a candidate who
     * coughed, or spoke too far from the microphone. That IS a silence, and
     * re-asking is the right response, so it returns null like one.
     */
    if (!transcript.trim()) {
      setPartial('');
      return null;
    }

    // The authoritative transcript replaces the interim one — unless it came
    // back empty, in which case whatever was heard live is better than telling
    // someone who just spoke that we caught nothing.
    setPartial((live) => transcript.trim() || live.trim() || "(we didn't catch that)");

    /*
     * The speech window comes from the CLIENT, measured between the first and
     * last moment the microphone was above the silence threshold.
     *
     * Kept even now that word timings are back, because it is the truer answer
     * duration: it excludes the thinking pause before the candidate started,
     * which would otherwise drag their words-per-minute down for having
     * considered the question. The word timings serve a different purpose —
     * the gaps BETWEEN words, which is the pause profile.
     */
    const speechMs = Math.max(0, recorded.endedAt - recorded.startedAt);
    const base = startedAt.current ?? recorded.startedAt;

    return {
      transcript,
      durationSec: speechMs / 1000,
      wordCount: words.length || transcript.split(/\s+/).filter(Boolean).length,
      startMs: recorded.startedAt - base,
      endMs: recorded.endedAt - base,
      asrConfidence,
      // Uploaded to Storage by /turn and read once by E2 at evaluation time.
      words,
    };
  }, [sessionId, recordAnswer, acquireMicrophone, failCaptureIfExhausted]);

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
   * The skill round's equivalent. Same shape, one difference that matters.
   *
   * There is no test tally to put in the header line, because nothing ran —
   * SV reads this submission after the interview. So the header states what the
   * task was instead, which is what the interviewer needs in order to ask its
   * follow-up about the right thing.
   */
  const runSkillRound = useCallback(async (): Promise<Record<string, unknown> | null> => {
    pauseBillingForCoding();

    const summary = await new Promise<SkillSummary | null>((resolve) => {
      skillDoneRef.current = resolve;
    });

    resumeBillingAfterCoding();
    skillDoneRef.current = null;
    setSkillChallenge(null);

    if (!summary) return null;

    return {
      transcript:
        `[Submitted ${summary.skill} ${summary.format} task "${summary.title}" in ${summary.language}]

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

        // Either module section replaces listening with the editor. Everything
        // else — including the turns AFTER a submission, where the interviewer
        // asks about what was written — goes back to the microphone.
        answer =
          (next.mode === 'coding' && next.challenge
            ? await runCodingRound()
            : next.mode === 'skill_challenge' && next.skillChallenge
              ? await runSkillRound()
              : await captureAnswer()) ?? undefined;
      }
    } finally {
      loopRunning.current = false;
    }
  }, [runTurn, captureAnswer, runCodingRound, runSkillRound]);

  const begin = useCallback(async () => {
    try {
      /*
       * Opened FIRST, while the click that called this is still the current
       * user gesture. A context created later — after the `await` below has
       * spent the gesture — starts suspended, and on some browsers `resume()`
       * on it then stays pending until the next click that never comes.
       */
      await audioContext();

      await acquireMicrophone();

      startedAt.current = Date.now();
      // Pre-warm the voice token so the first answer starts instantly
      void voiceToken();
      void runLoop();
    } catch (err) {
      console.error('[interview] could not start the microphone', err);
      setError('We need your microphone to run the interview.');
      setPhase('failed');
    }
  }, [acquireMicrophone, audioContext, voiceToken, runLoop]);

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

    // Release a loop parked on either editor promise, or it never returns.
    codingDoneRef.current?.(null as unknown as CodingSummary);
    skillDoneRef.current?.(null);
    stopPlaybackRef.current?.();
    // Dropped, not drained: the interview is over, so there is no answer left
    // to recover and nothing to wait for the trailing finals on.
    liveSttRef.current?.abort();
    liveSttRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    try {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    } catch {
      /* already stopped */
    }

    audioElRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    // The page's one context, closed here and nowhere else — playback used to
    // close it after every clip, which is what left the microphone dead.
    micCtxRef.current?.close().catch(() => null);
    micCtxRef.current = null;
    analyserRef.current = null;
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

  /*
   * Leaving the page by any route — back button, a redirect, a crash elsewhere
   * — must stop the loop too.
   *
   * Routed through a ref so the effect can depend on nothing. Registering
   * `teardown` itself as the cleanup with `[teardown]` meant that the day
   * anything in its closure stopped being stable, React would run it BETWEEN
   * renders: microphone stopped, socket aborted, loop aborted, mid-interview,
   * for a re-render. Unmount is the only event that should reach it.
   */
  const teardownRef = useRef(teardown);
  useEffect(() => {
    teardownRef.current = teardown;
  }, [teardown]);
  useEffect(() => () => teardownRef.current(), []);

  useEffect(() => {
    mutedRef.current = muted;
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

  // The skill round takes the screen on the same terms, and is checked second
  // so that a stale coding challenge can never be masked by one.
  if (skillChallenge) {
    return (
      <SkillMode
        sessionId={sessionId}
        challenge={skillChallenge}
        elapsedLabel={formatTime(elapsed)}
        waveform={<Waveform phase={phase} amplitude={amplitude} />}
        interviewerLine={question}
        getDraft={getSkillDraft}
        onDraftChange={saveSkillDraft}
        onSubmitted={(summary) => skillDoneRef.current?.(summary)}
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
          {/*
            What this question is for, above the question and deliberately
            quieter than it.

            Only the goal STATEMENT is shown. The evidence descriptions behind it
            ("Names the specific workload deployed") travel in the same payload
            and are stored with the question, but they are the marking scheme —
            putting them on screen would tell the candidate the exact phrase that
            scores, and the answer would stop measuring anything.
          */}
          {questionGoal && (
            <div className="max-w-2xl mx-auto text-center mb-5">
              <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-[#1B1F3B]/45">
                What I&apos;m trying to find out
              </p>
              <p className="text-sm md:text-base text-[#1B1F3B]/70 leading-snug mt-1.5">
                {questionGoal.statement}
              </p>
            </div>
          )}

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
