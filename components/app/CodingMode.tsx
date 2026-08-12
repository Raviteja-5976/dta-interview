/**
 * Coding mode — the LeetCode-style split (sitemap-workflow.md §9).
 *
 * Problem left, editor right, results underneath, the interviewer collapsed to a
 * rail so the waveform stays visible without competing with the code.
 *
 * Two rules this layout has to honour:
 *   · Hidden test results do not appear until after submission. Before that the
 *     round becomes a guessing game against the grader rather than a reasoning
 *     exercise.
 *   · No scores, no correctness verdict on the answer itself. Pass/fail on a
 *     test is mechanical fact; a judgement about the candidate is not, and
 *     mid-interview evaluation corrupts the data (agentdesign R5).
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Play, Send, X } from 'lucide-react';

import { Button, Chip } from './ui';
import MonacoEditor from './MonacoEditor';
import type { LanguageId, TestResult } from '@/lib/execution/types';

export interface CodingChallengeView {
  index: number;
  total: number;
  title: string;
  problem_statement: string;
  input_format: string;
  output_format: string;
  examples: Array<{ input: string; output: string; explanation: string }>;
  starter_code: Array<{ language: string; code: string }>;
  visible_tests: Array<{ input: string; expected: string }>;
  target_complexity: { time: string; space: string };
  hidden_test_count: number;
}

/** Work in progress, held by the page so it survives the editor closing between turns. */
export interface CodeDraft {
  language: LanguageId;
  source: string;
}

interface RunResponse {
  runnerAvailable: boolean;
  /** The runner had no free capacity. Nothing ran; this is not a failure. */
  busy?: boolean;
  message?: string;
  results: TestResult[];
  passed: number;
  total: number;
  hiddenPassed?: number;
  hiddenTotal?: number;
  compileError?: string;
}

function normaliseLanguage(label: string): LanguageId {
  const l = label.toLowerCase();
  if (l.includes('python')) return 'python';
  if (l.includes('typescript')) return 'typescript';
  if (l.includes('javascript') || l.includes('node')) return 'javascript';
  if (l.includes('java')) return 'java';
  if (l.includes('c++') || l.includes('cpp')) return 'cpp';
  if (l.includes('go')) return 'go';
  return 'python';
}

export default function CodingMode({
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
  challenge: CodingChallengeView;
  /** The interviewer rail — kept visible so the round still feels like an interview. */
  waveform: React.ReactNode;
  elapsedLabel: string;
  /** The question the interviewer just asked, in text. */
  interviewerLine?: string;
  /**
   * Work in progress from a previous visit to this challenge, if any. A getter
   * rather than a value because the page keeps drafts in a ref — read once at
   * mount, never re-read during a render.
   */
  getDraft?: (challengeIndex: number) => CodeDraft | undefined;
  onDraftChange?: (challengeIndex: number, draft: CodeDraft) => void;
  /** Called once the candidate has submitted and wants to talk it through. */
  onSubmitted: (summary: { passed: number; total: number; language: string; source: string }) => void;
}) {
  const languages = useMemo(
    () => challenge.starter_code.map((s) => ({ id: normaliseLanguage(s.language), raw: s })),
    [challenge],
  );

  // Lazy initialisers: the restored draft is read once, at mount.
  const [language, setLanguage] = useState<LanguageId>(
    () => getDraft?.(challenge.index)?.language ?? languages[0]?.id ?? 'python',
  );
  const [source, setSource] = useState(
    () => getDraft?.(challenge.index)?.source ?? languages[0]?.raw.code ?? '',
  );
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Mirrored up to the page as it changes. A ref write on the other end, so it
  // costs a function call and no render.
  useEffect(() => {
    onDraftChange?.(challenge.index, { language, source });
  }, [challenge.index, language, source, onDraftChange]);

  /**
   * Switching language swaps in that language's starter code — but only while
   * the candidate has not started writing. Replacing work someone has already
   * done because they tapped the wrong tab is unforgivable.
   *
   * Done in the handler rather than an effect: this is a response to an event,
   * not state derived from a render.
   */
  const switchLanguage = useCallback(
    (next: LanguageId) => {
      const untouched = languages.some((l) => l.raw.code.trim() === source.trim());
      setLanguage(next);
      if (untouched) {
        const starter = languages.find((l) => l.id === next);
        if (starter) setSource(starter.raw.code);
      }
    },
    [languages, source],
  );

  const execute = useCallback(
    async (action: 'run' | 'submit') => {
      setBusy(action);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, language, source, challengeIndex: challenge.index }),
        });
        const data = (await res.json()) as RunResponse;
        setResult(data);

        // A busy runner is not a submission — do not advance the round.
        if (action === 'submit' && res.ok && !data.busy) {
          setSubmitted(true);
          onSubmitted({
            passed: data.passed ?? 0,
            total: data.total ?? 0,
            language,
            source,
          });
        }
      } catch {
        setResult({
          runnerAvailable: false,
          message: 'Could not reach the code runner. Your code is still saved.',
          results: [],
          passed: 0,
          total: 0,
        });
      } finally {
        setBusy(null);
      }
    },
    [sessionId, language, source, challenge.index, onSubmitted],
  );

  return (
    /*
     * Exactly one viewport tall on a desktop, with each pane scrolling on its
     * own — the LeetCode arrangement, and the reason it works: the editor never
     * scrolls off the screen while you read the problem. Below `lg` the split
     * collapses to a stack and the page scrolls normally, because a 40-column
     * editor beside a problem statement is not usable on a phone.
     */
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-[#FFF8F0] flex flex-col">
      {/* Top strip */}
      <div className="shrink-0 border-b-4 border-[#1B1F3B] bg-white px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Chip accent="sky">Coding</Chip>
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
          {/* The candidate should know the meter has stopped. */}
          <Chip accent="mint">Timer paused</Chip>
        </div>
      </div>

      <div className="flex-1 grid lg:grid-cols-2 gap-0 min-h-0">
        {/* ── Left: the problem ────────────────────────────────────────────── */}
        <div className="border-r-0 lg:border-r-4 border-[#1B1F3B] min-h-0 lg:overflow-y-auto p-5 space-y-5">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold mb-3">
              {challenge.title}
            </h1>
            <p className="text-sm text-[#1B1F3B]/85 leading-relaxed whitespace-pre-wrap">
              {challenge.problem_statement}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <Block label="Input">{challenge.input_format}</Block>
            <Block label="Output">{challenge.output_format}</Block>
          </div>

          {challenge.examples.map((ex, i) => (
            <div key={i} className="border-2 border-[#1B1F3B] rounded-2xl overflow-hidden">
              <div className="bg-[#F5EBE0] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider">
                Example {i + 1}
              </div>
              <div className="p-3 space-y-2 font-[family-name:var(--font-mono)] text-xs">
                <div>
                  <span className="text-[#1B1F3B]/55">Input</span>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words">{ex.input}</pre>
                </div>
                <div>
                  <span className="text-[#1B1F3B]/55">Output</span>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words">{ex.output}</pre>
                </div>
                {ex.explanation && (
                  <p className="text-[#1B1F3B]/70 font-[family-name:var(--font-body)]">
                    {ex.explanation}
                  </p>
                )}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Chip>Time {challenge.target_complexity.time}</Chip>
            <Chip>Space {challenge.target_complexity.space}</Chip>
            <Chip>{challenge.hidden_test_count} hidden tests</Chip>
          </div>

          {/* The interviewer rail. Reduced, never removed — this is still a
              conversation, and thinking out loud is graded. */}
          <div className="border-4 border-[#1B1F3B] rounded-3xl p-4 bg-white">
            <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 mb-2">
              Your interviewer
            </p>
            {waveform}
            {interviewerLine && (
              <p className="text-sm text-[#1B1F3B] mt-3 leading-relaxed">{interviewerLine}</p>
            )}
            <p className="text-xs text-[#1B1F3B]/70 mt-2">
              Talk through what you&apos;re doing as you write. How you explain your approach is
              part of what gets reviewed.
            </p>
          </div>
        </div>

        {/* ── Right: the editor ────────────────────────────────────────────── */}
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b-2 border-[#1B1F3B] bg-[#F5EBE0]">
            {languages.map((l) => (
              <button
                key={l.id}
                onClick={() => switchLanguage(l.id)}
                className={`px-3 py-1 rounded-full border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase transition-colors ${
                  language === l.id ? 'bg-[#1B1F3B] text-white' : 'bg-white text-[#1B1F3B]'
                }`}
              >
                {l.raw.language}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-[320px] lg:min-h-0 bg-[#FFFDF9]">
            <MonacoEditor language={language} value={source} onChange={setSource} />
          </div>

          {/* Results */}
          <div className="border-t-4 border-[#1B1F3B] bg-white max-h-64 overflow-y-auto shrink-0">
            {result ? (
              <div className="p-4 space-y-3">
                {(!result.runnerAvailable || result.busy) && (
                  <p
                    className={`text-sm p-3 border-2 border-[#1B1F3B] rounded-2xl ${
                      result.busy ? 'bg-[#FFC93C]/25' : 'text-[#1B1F3B]/75'
                    }`}
                  >
                    {result.message}
                  </p>
                )}

                {result.compileError && (
                  <div className="p-3 border-2 border-[#FF5C7A] rounded-2xl bg-[#FF5C7A]/10">
                    <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider mb-1">
                      Compile error
                    </p>
                    <pre className="font-[family-name:var(--font-mono)] text-xs whitespace-pre-wrap">
                      {result.compileError}
                    </pre>
                  </div>
                )}

                {result.results.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span
                      className="shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 border-[#1B1F3B] flex items-center justify-center"
                      style={{ backgroundColor: r.verdict === 'passed' ? '#6EE7B7' : '#FF5C7A' }}
                    >
                      {r.verdict === 'passed' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                    <div className="min-w-0 font-[family-name:var(--font-mono)]">
                      <p className="font-bold">
                        Test {i + 1} · {r.verdict.replace(/_/g, ' ')}
                      </p>
                      {r.verdict !== 'passed' && (
                        <p className="text-[#1B1F3B]/65 break-words">
                          expected <span className="text-[#1B1F3B]">{r.expected}</span> · got{' '}
                          <span className="text-[#1B1F3B]">{r.actual || '(nothing)'}</span>
                        </p>
                      )}
                      {r.stderr && (
                        <pre className="text-[#FF5C7A] whitespace-pre-wrap break-words mt-0.5">
                          {r.stderr.slice(0, 300)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}

                {/* Hidden tests: a tally only, and only after submitting. */}
                {result.hiddenTotal !== undefined && (
                  <div className="pt-2 border-t-2 border-[#1B1F3B]/15">
                    <p className="font-[family-name:var(--font-mono)] text-xs font-bold">
                      Hidden tests: {result.hiddenPassed}/{result.hiddenTotal} passed
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="p-4 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55">
                Run your code against the examples, then submit when you&apos;re happy with it.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="shrink-0 border-t-2 border-[#1B1F3B] p-3 flex items-center justify-between gap-3 bg-[#F5EBE0]">
            <Button variant="secondary" onClick={() => void execute('run')} disabled={busy !== null}>
              {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run tests
            </Button>

            <Button onClick={() => void execute('submit')} disabled={busy !== null}>
              {busy === 'submit' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitted ? 'Submit again' : 'Submit'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-[#1B1F3B] rounded-2xl p-3">
      <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55">
        {label}
      </p>
      <p className="text-xs text-[#1B1F3B]/85 mt-1 whitespace-pre-wrap">{children}</p>
    </div>
  );
}
