/**
 * Skill challenge mode — the hands-on round.
 *
 * Task on the left, editor on the right, the interviewer collapsed to a rail.
 * The same split as CodingMode, and deliberately so: a candidate who has just
 * done the DSA round should not have to learn a second screen.
 *
 * What is different is what is NOT here. There is no Run button and no results
 * pane, because there is nothing to run — no sandbox can render a React
 * component or execute a query against a schema that exists only in the
 * prompt. The work is reviewed after the interview.
 *
 * That absence is stated on the screen rather than left to be discovered.
 * Someone who has used LeetCode expects a green tick before they submit, and a
 * missing one reads as broken unless you say why it is missing.
 *
 * The rules from CodingMode still hold here: no score, no correctness verdict,
 * nothing evaluative before the report (agentdesign R5). The only thing this
 * screen ever says back is that the submission was recorded.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bug, Check, Database, Loader2, PenLine, Send, Wrench } from 'lucide-react';

import { Button, Chip } from './ui';
import MonacoEditor, { type EditorLanguage } from './MonacoEditor';

export interface SkillChallengeView {
  index: number;
  total: number;
  skill: string;
  format: 'implement' | 'debug' | 'query' | 'design';
  title: string;
  prompt: string;
  context: string | null;
  editor_language: EditorLanguage;
  starter_code: string;
  estimated_minutes: number;
  /** How many things are being looked for. The count, never the list. */
  requirement_count: number;
}

/** Work in progress, held by the page so it survives the editor closing between turns. */
export interface SkillDraft {
  source: string;
}

export interface SkillSummary {
  skill: string;
  format: SkillChallengeView['format'];
  title: string;
  language: string;
  source: string;
  elapsedSec: number;
}

/** What each format is called on screen, and what the candidate is being asked to do. */
const FORMAT_META: Record<
  SkillChallengeView['format'],
  { label: string; icon: typeof Wrench; instruction: string; action: string }
> = {
  implement: {
    label: 'Build it',
    icon: Wrench,
    instruction: 'Write the implementation in the editor. Talk through your choices as you go.',
    action: 'Submit implementation',
  },
  debug: {
    label: 'Find the bug',
    icon: Bug,
    instruction:
      'The code on the right runs, and it is wrong. Find the fault, fix it in place, and say out loud what it was.',
    action: 'Submit fix',
  },
  query: {
    label: 'Write the query',
    icon: Database,
    instruction: 'Write the query against the schema on the left.',
    action: 'Submit query',
  },
  design: {
    label: 'Design it',
    icon: PenLine,
    instruction:
      'Talk this one through out loud — that is what is being listened to. Use the pane on the right for the sketch: components, data flow, the trade-offs you are making.',
    action: 'Submit design notes',
  },
};

export default function SkillMode({
  sessionId,
  challenge,
  waveform,
  elapsedLabel,
  interviewerLine,
  getDraft,
  onDraftChange,
  onSubmitted,
}: {
  sessionId: string;
  challenge: SkillChallengeView;
  /** The interviewer rail — kept visible so the round still feels like an interview. */
  waveform: React.ReactNode;
  elapsedLabel: string;
  /** The question the interviewer just asked, in text. */
  interviewerLine?: string;
  getDraft?: (challengeIndex: number) => SkillDraft | undefined;
  onDraftChange?: (challengeIndex: number, draft: SkillDraft) => void;
  onSubmitted: (summary: SkillSummary) => void;
}) {
  const meta = FORMAT_META[challenge.format];
  const Icon = meta.icon;

  // Lazy initialiser: the restored draft is read once, at mount. A candidate
  // who came back to this task must not find the starter code again.
  const [source, setSource] = useState(
    () => getDraft?.(challenge.index)?.source ?? challenge.starter_code ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Wall clock on this task, for the report. Started at mount rather than at
   * first keystroke: reading the problem is part of the task.
   *
   * Stamped in an effect rather than as the ref's initial value, because
   * `Date.now()` in a render body is impure — a re-render before the effect
   * runs would produce a different "start" each time.
   */
  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    openedAt.current ??= Date.now();
  }, []);

  useEffect(() => {
    onDraftChange?.(challenge.index, { source });
  }, [challenge.index, source, onDraftChange]);

  const untouched = useMemo(
    () => source.trim() === (challenge.starter_code ?? '').trim(),
    [source, challenge.starter_code],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);

    const elapsedSec = openedAt.current ? Math.round((Date.now() - openedAt.current) / 1000) : 0;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeIndex: challenge.index, source, elapsedSec }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Nothing was recorded, so the round must not advance — the candidate
        // still has their work and can try again.
        setError(data.error ?? 'We could not save that. Try submitting again.');
        return;
      }

      setSubmitted(true);
      onSubmitted({
        skill: challenge.skill,
        format: challenge.format,
        title: challenge.title,
        language: challenge.editor_language,
        source,
        elapsedSec,
      });
    } catch {
      setError('Could not reach the server. Your work is still here — try again.');
    } finally {
      setBusy(false);
    }
  }, [sessionId, challenge, source, onSubmitted]);

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-[#FFF8F0] flex flex-col">
      {/* Top strip */}
      <div className="shrink-0 border-b-4 border-[#1B1F3B] bg-white px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Chip accent="yellow">{challenge.skill}</Chip>
          <Chip>{meta.label}</Chip>
          {challenge.total > 1 && (
            <Chip>
              {challenge.index + 1} of {challenge.total}
            </Chip>
          )}
          <span className="font-[family-name:var(--font-display)] font-extrabold text-sm truncate">
            {challenge.title}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Chip>{elapsedLabel}</Chip>
          <Chip accent="mint">Timer paused</Chip>
        </div>
      </div>

      <div className="flex-1 grid lg:grid-cols-2 gap-0 min-h-0">
        {/* ── Left: the task ───────────────────────────────────────────────── */}
        <div className="border-r-0 lg:border-r-4 border-[#1B1F3B] min-h-0 lg:overflow-y-auto p-5 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-5 h-5 shrink-0" />
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold">
                {challenge.title}
              </h1>
            </div>
            <p className="text-sm text-[#1B1F3B]/85 leading-relaxed whitespace-pre-wrap">
              {challenge.prompt}
            </p>
          </div>

          <div className="border-2 border-[#1B1F3B] rounded-2xl p-3 bg-[#FFC93C]/15">
            <p className="text-sm text-[#1B1F3B]">{meta.instruction}</p>
          </div>

          {/* The schema, the props contract, the sample rows — whatever the task
              needs that is not the task. Monospaced: it is nearly always code. */}
          {challenge.context && (
            <div className="border-2 border-[#1B1F3B] rounded-2xl overflow-hidden">
              <div className="bg-[#F5EBE0] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider">
                {challenge.format === 'query' ? 'Schema' : 'What you are given'}
              </div>
              <pre className="p-3 font-[family-name:var(--font-mono)] text-xs whitespace-pre-wrap break-words">
                {challenge.context}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Chip>~{challenge.estimated_minutes} min</Chip>
            <Chip>
              {challenge.requirement_count} thing{challenge.requirement_count === 1 ? '' : 's'} being looked
              for
            </Chip>
          </div>

          {/*
           * Says plainly that nothing runs here.
           *
           * Without it, the missing Run button reads as a broken page to anyone
           * who has used LeetCode — and a candidate who spends the round hunting
           * for a test runner is not spending it on the task.
           */}
          <div className="border-2 border-dashed border-[#1B1F3B]/40 rounded-2xl p-3">
            <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 mb-1">
              No test runner on this one
            </p>
            <p className="text-xs text-[#1B1F3B]/75">
              This round is reviewed by a human-grade reader after the interview, not by a test suite —
              so write it as you would in a pull request, and say why you did it that way.
            </p>
          </div>

          {/* The interviewer rail. Reduced, never removed — thinking out loud
              is graded here just as it is in the coding round. */}
          <div className="border-4 border-[#1B1F3B] rounded-3xl p-4 bg-white">
            <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 mb-2">
              Your interviewer
            </p>
            {waveform}
            {interviewerLine && (
              <p className="text-sm text-[#1B1F3B] mt-3 leading-relaxed">{interviewerLine}</p>
            )}
          </div>
        </div>

        {/* ── Right: the editor ────────────────────────────────────────────── */}
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b-2 border-[#1B1F3B] bg-[#F5EBE0]">
            <span className="px-3 py-1 rounded-full border-2 border-[#1B1F3B] bg-[#1B1F3B] text-white font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase">
              {challenge.editor_language === 'markdown' ? 'Notes' : challenge.editor_language}
            </span>
            {challenge.format === 'debug' && (
              <span className="font-[family-name:var(--font-mono)] text-[11px] text-[#1B1F3B]/70">
                Edit in place — do not rewrite from scratch.
              </span>
            )}
          </div>

          <div className="flex-1 min-h-[320px] lg:min-h-0 bg-[#FFFDF9]">
            <MonacoEditor language={challenge.editor_language} value={source} onChange={setSource} />
          </div>

          <div className="border-t-4 border-[#1B1F3B] bg-white shrink-0 p-4">
            {error ? (
              <p className="text-sm p-3 border-2 border-[#FF5C7A] rounded-2xl bg-[#FF5C7A]/10">{error}</p>
            ) : submitted ? (
              <p className="text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full border-2 border-[#1B1F3B] bg-[#6EE7B7] flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
                Submitted. Your interviewer will pick this up from here.
              </p>
            ) : (
              <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55">
                {untouched
                  ? 'Nothing changed yet.'
                  : 'Submit when you are happy with it. You can keep talking after you do.'}
              </p>
            )}
          </div>

          <div className="shrink-0 border-t-2 border-[#1B1F3B] p-3 flex items-center justify-end gap-3 bg-[#F5EBE0]">
            {/* Submitting an untouched editor is almost always an accident —
                but it stays possible, because "I would not change anything" is
                a legitimate answer to a debug task and blocking it would be
                deciding the answer for them. */}
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitted ? 'Submit again' : meta.action}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
