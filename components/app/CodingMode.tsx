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
 *
 * The editor works the way LeetCode's does: pick a language and its template
 * loads; code written in each language is kept separately, so switching back
 * finds it; Reset restores the template. The template is only the method —
 * input and output are handled by the harness when the code runs.
 *
 * Each language is its own editor document, with its own undo history — so
 * switching from Python to Java and pressing undo cannot bring the Python back
 * into the Java editor. Every result says which language it ran as.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Minus, Play, RotateCcw, Send, X } from 'lucide-react';

import { Button, Chip } from './ui';
import MonacoEditor from './MonacoEditor';
import {
  LANGUAGES,
  type FunctionSignature,
  type LanguageId,
  type TestResult,
  type TestVerdict,
} from '@/lib/execution/types';

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
  /** Present for LeetCode-style problems; labels test inputs by parameter. */
  signature?: FunctionSignature | null;
}

/** Work in progress, held by the page so it survives the editor closing between turns. */
export interface CodeDraft {
  language: LanguageId;
  source: string;
  /** What has been written in each language, so switching back finds it. */
  byLanguage?: Partial<Record<LanguageId, string>>;
}

interface RunResponse {
  runnerAvailable: boolean;
  /** The runner had no free capacity. Nothing ran; this is not a failure. */
  busy?: boolean;
  /** The request itself failed — shown as a message, never as test results. */
  failed?: boolean;
  message?: string;
  results: TestResult[];
  passed: number;
  total: number;
  hiddenPassed?: number;
  hiddenTotal?: number;
  compileError?: string;
  /** What the candidate's own print statements wrote. */
  log?: string;
  /** The language the code was run as — shown, so it is never a guess. */
  language: LanguageId;
}

function labelOf(id: LanguageId): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

const VERDICT_LABEL: Record<TestVerdict, string> = {
  passed: 'Accepted',
  wrong_answer: 'Wrong answer',
  runtime_error: 'Runtime error',
  time_limit: 'Time limit exceeded',
  compile_error: 'Compile error',
  internal_error: 'Runner error',
  not_run: 'Not run',
};

/**
 * Starter-code labels → language ids. New challenges store the id itself;
 * older ones stored a display name ("Python", "Java 17").
 */
function normaliseLanguage(label: string): LanguageId | null {
  const l = label.trim().toLowerCase();
  if (l.startsWith('python')) return 'python';
  if (l.startsWith('javascript') || l === 'js' || l.startsWith('node')) return 'javascript';
  if (l.startsWith('java')) return 'java';
  if (l === 'cpp' || l.startsWith('c++')) return 'cpp';
  if (l === 'c' || l.startsWith('c (')) return 'c';
  return null;
}

/** A test's JSON lines as LeetCode shows a testcase: `nums = [2,7,11,15]`. */
function describeInput(input: string, signature?: FunctionSignature | null): string {
  const lines = input.split('\n');
  if (!signature || lines.length !== signature.params.length) return input;
  return lines.map((line, i) => `${signature.params[i].name} = ${line}`).join('\n');
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
  /** Each language's template, keyed by id. */
  const starters = useMemo(() => {
    const map = new Map<LanguageId, string>();
    for (const s of challenge.starter_code) {
      const id = normaliseLanguage(s.language);
      if (id && !map.has(id)) map.set(id, s.code);
    }
    return map;
  }, [challenge.starter_code]);

  /** The picker, in LeetCode's order, limited to what this problem has templates for. */
  const languages = useMemo(() => LANGUAGES.filter((l) => starters.has(l.id)), [starters]);

  // Lazy initialisers: the restored draft is read once, at mount.
  const [language, setLanguage] = useState<LanguageId>(() => {
    const draft = getDraft?.(challenge.index);
    if (draft && starters.has(draft.language)) return draft.language;
    return languages[0]?.id ?? 'python';
  });

  const [byLanguage, setByLanguage] = useState<Partial<Record<LanguageId, string>>>(() => {
    const draft = getDraft?.(challenge.index);
    return draft ? { ...(draft.byLanguage ?? {}), [draft.language]: draft.source } : {};
  });

  // What is in the editor: this language's own work, or its template.
  const source = byLanguage[language] ?? starters.get(language) ?? '';

  const [busy, setBusy] = useState<'run' | 'submit' | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const setSource = useCallback(
    (next: string) => setByLanguage((prev) => ({ ...prev, [language]: next })),
    [language],
  );

  // Mirrored up to the page as it changes. A ref write on the other end, so it
  // costs a function call and no render.
  useEffect(() => {
    onDraftChange?.(challenge.index, { language, source, byLanguage });
  }, [challenge.index, language, source, byLanguage, onDraftChange]);

  /**
   * Back to this language's template.
   *
   * Asked first: it throws away work, and a misclick costs someone their
   * solution in a timed round.
   */
  const resetCode = useCallback(() => {
    if (!window.confirm('Reset to the starting template? Your code in this language will be replaced.')) return;
    setByLanguage((prev) => {
      const next = { ...prev };
      delete next[language];
      return next;
    });
  }, [language]);

  const execute = useCallback(
    async (action: 'run' | 'submit') => {
      setBusy(action);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, language, source, challengeIndex: challenge.index }),
        });
        const data = (await res.json().catch(() => null)) as (Partial<RunResponse> & { error?: string }) | null;

        /*
         * Normalised before it reaches state.
         *
         * An error response has no `results`, and rendering it as if it did used
         * to take the whole editor down — so one failed run meant no more runs.
         * Anything that is not a proper result is shown as a message, and the
         * editor stays usable.
         */
        const ok = res.ok && data !== null;
        setResult({
          language,
          runnerAvailable: data?.runnerAvailable ?? true,
          busy: data?.busy,
          failed: !ok,
          message: ok
            ? data?.message
            : (data?.error ?? 'Your code could not be run just now. It is saved — try again.'),
          results: Array.isArray(data?.results) ? data.results : [],
          passed: data?.passed ?? 0,
          total: data?.total ?? 0,
          hiddenPassed: data?.hiddenPassed,
          hiddenTotal: data?.hiddenTotal,
          compileError: data?.compileError,
          log: data?.log,
        });

        // A busy runner or a failed request is not a submission — do not
        // advance the round.
        if (action === 'submit' && ok && !data?.busy) {
          setSubmitted(true);
          onSubmitted({
            passed: data?.passed ?? 0,
            total: data?.total ?? 0,
            language,
            source,
          });
        }
      } catch {
        setResult({
          language,
          runnerAvailable: false,
          failed: true,
          message: 'Could not reach the code runner. Your code is still saved — try again.',
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

  const showMessage = result && (result.failed || result.busy || !result.runnerAvailable) && result.message;

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
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b-2 border-[#1B1F3B] bg-[#F5EBE0]">
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageId)}
              className="px-3 py-1 rounded-full border-2 border-[#1B1F3B] bg-white font-[family-name:var(--font-mono)] text-[12px] font-bold text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
            >
              {languages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={resetCode}
              disabled={byLanguage[language] === undefined}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border-2 border-[#1B1F3B] bg-white font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase text-[#1B1F3B] disabled:opacity-40"
              title="Reset to the starting template"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>

          <div className="flex-1 min-h-[320px] lg:min-h-0 bg-[#FFFDF9]">
            {/* One document per problem and language — see the file header. */}
            <MonacoEditor
              path={`coding-${challenge.index}/solution.${LANGUAGES.find((l) => l.id === language)?.extension ?? language}`}
              language={language}
              value={source}
              onChange={setSource}
            />
          </div>

          {/* Results */}
          <div className="border-t-4 border-[#1B1F3B] bg-white max-h-72 overflow-y-auto shrink-0">
            {result ? (
              <div className="p-4 space-y-3">
                {showMessage && (
                  <p
                    className={`text-sm p-3 border-2 border-[#1B1F3B] rounded-2xl ${
                      result.busy ? 'bg-[#FFC93C]/25' : result.failed ? 'bg-[#FF5C7A]/10' : 'text-[#1B1F3B]/75'
                    }`}
                  >
                    {result.message}
                  </p>
                )}

                {result.compileError && (
                  <div className="p-3 border-2 border-[#FF5C7A] rounded-2xl bg-[#FF5C7A]/10">
                    <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider mb-1">
                      Compile error · {labelOf(result.language)}
                    </p>
                    <pre className="font-[family-name:var(--font-mono)] text-xs whitespace-pre-wrap break-words">
                      {result.compileError}
                    </pre>
                  </div>
                )}

                {!result.compileError && result.results.length > 0 && (
                  <p className="font-[family-name:var(--font-mono)] text-xs font-bold">
                    Ran as {labelOf(result.language)} ·{' '}
                    {result.results.filter((r) => r.verdict === 'passed').length}/{result.results.length} test
                    {result.results.length === 1 ? '' : 's'} passed
                  </p>
                )}

                {/* A result from another language is still on screen after a switch. */}
                {result.language !== language && (
                  <p className="text-xs p-2 border-2 border-dashed border-[#1B1F3B]/40 rounded-xl text-[#1B1F3B]/75">
                    These results are from your {labelOf(result.language)} code. Run again to test your{' '}
                    {labelOf(language)} code.
                  </p>
                )}

                {!result.compileError &&
                  result.results.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span
                        className="shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 border-[#1B1F3B] flex items-center justify-center"
                        style={{
                          backgroundColor:
                            r.verdict === 'passed' ? '#6EE7B7' : r.verdict === 'not_run' ? '#E5E1DA' : '#FF5C7A',
                        }}
                      >
                        {r.verdict === 'passed' ? (
                          <Check className="w-3 h-3" />
                        ) : r.verdict === 'not_run' ? (
                          <Minus className="w-3 h-3" />
                        ) : (
                          <X className="w-3 h-3" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 font-[family-name:var(--font-mono)]">
                        <p className="font-bold">
                          Case {i + 1} · {VERDICT_LABEL[r.verdict] ?? r.verdict}
                        </p>
                        {r.verdict !== 'passed' && r.verdict !== 'not_run' && (
                          <div className="mt-1 space-y-1 text-[#1B1F3B]/70">
                            <div>
                              <span className="text-[#1B1F3B]/55">Input</span>
                              <pre className="whitespace-pre-wrap break-words text-[#1B1F3B]">
                                {describeInput(r.input, challenge.signature)}
                              </pre>
                            </div>
                            <p className="break-words">
                              <span className="text-[#1B1F3B]/55">Expected </span>
                              <span className="text-[#1B1F3B]">{r.expected}</span>
                            </p>
                            {r.verdict === 'wrong_answer' && (
                              <p className="break-words">
                                <span className="text-[#1B1F3B]/55">Output </span>
                                <span className="text-[#1B1F3B]">{r.actual || '(nothing)'}</span>
                              </p>
                            )}
                          </div>
                        )}
                        {r.stderr && (
                          <pre className="text-[#FF5C7A] whitespace-pre-wrap break-words mt-1">
                            {r.stderr.slice(0, 800)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))}

                {/* Their own print statements — kept apart from the answers. */}
                {result.log && (
                  <div className="pt-2 border-t-2 border-[#1B1F3B]/15">
                    <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider text-[#1B1F3B]/55 mb-1">
                      Stdout
                    </p>
                    <pre className="font-[family-name:var(--font-mono)] text-xs whitespace-pre-wrap break-words">
                      {result.log.slice(0, 2000)}
                    </pre>
                  </div>
                )}

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
              // Before the first run: the testcases, as LeetCode shows them.
              <div className="p-4 space-y-3">
                <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wider text-[#1B1F3B]/55">
                  Testcases
                </p>
                {challenge.visible_tests.map((t, i) => (
                  <div key={i} className="font-[family-name:var(--font-mono)] text-xs">
                    <p className="font-bold">Case {i + 1}</p>
                    <pre className="whitespace-pre-wrap break-words text-[#1B1F3B]/75">
                      {describeInput(t.input, challenge.signature)}
                    </pre>
                  </div>
                ))}
                <p className="text-xs text-[#1B1F3B]/60">
                  Run your code against these, then submit when you&apos;re happy with it.
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="shrink-0 border-t-2 border-[#1B1F3B] p-3 flex items-center justify-between gap-3 bg-[#F5EBE0]">
            <Button variant="secondary" onClick={() => void execute('run')} disabled={busy !== null}>
              {busy === 'run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run
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
