/**
 * POST /api/sessions/[sessionId]/code — run or submit a coding answer.
 *
 * `action: 'run'`    → visible tests only. The candidate's own feedback loop.
 * `action: 'submit'` → visible AND hidden tests, recorded against the session.
 *
 * sitemap §9: hidden test results do not appear until after submission. Showing
 * them during `run` would turn the round into a guessing game against the
 * grader instead of a reasoning exercise.
 *
 * LeetCode-style problems — the ones with a signature — run the candidate's
 * method inside the harness, every test in one execution (lib/execution/
 * harness.ts). Challenges stored before that still run as whole programs.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCodeRunner, isLanguageId, outputsMatch, type TestResult } from '@/lib/execution';
import { isFunctionSignature } from '@/lib/execution/harness';
import type { CodingChallenge } from '@/lib/agents/schemas';
import type { ChallengeSet } from '@/lib/agents/p7-challenge';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

/** A run is bounded well inside 30s by the runner (see RUN_DEADLINE_MS). */
export const maxDuration = 60;

interface CodeBody {
  action: 'run' | 'submit';
  language: string;
  source: string;
  challengeIndex?: number;
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[sessionId]/code'>) {
  try {
    const { sessionId } = await ctx.params;
    await requireUser();

    const supabase = await createSupabaseServerClient();
    const { data: session } = await supabase
      .from('sessions')
      .select('id, user_id, status, coding_challenge, live_state')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) return notFound();

    const body = (await request.json()) as CodeBody;
    if (body.action !== 'run' && body.action !== 'submit') return failure(400, 'Unknown action.');
    if (!body.source?.trim()) return failure(400, 'There is no code to run.');
    if (!isLanguageId(body.language)) return failure(400, 'That language is not available in this round.');
    const language = body.language;

    const set = session.coding_challenge as ChallengeSet<CodingChallenge> | null;
    const challenge = set?.challenges?.[body.challengeIndex ?? 0];
    if (!challenge) return failure(409, 'This interview has no coding challenge.');

    // Absent on challenges stored before the harness existed.
    const storedSignature = (challenge as { signature?: unknown }).signature;
    const signature = isFunctionSignature(storedSignature) ? storedSignature : undefined;

    const runner = getCodeRunner();
    if (!runner.isConfigured()) {
      // Honest degradation: the answer is still recorded and still graded on
      // reasoning, but nothing is claimed about whether the code works.
      return ok({
        runnerAvailable: false,
        message:
          'Automatic test running is not switched on, so your code will be reviewed on approach rather than test results.',
        results: [],
        passed: 0,
        total: 0,
      });
    }

    const visible = challenge.visible_tests.map((t) => ({ input: t.input, expected: t.expected }));
    const hidden = challenge.hidden_tests.map((t) => ({ input: t.input, expected: t.expected }));
    const tests = body.action === 'submit' ? [...visible, ...hidden] : visible;

    const result = await runner.run({
      language,
      source: body.source,
      tests,
      signature,
      timeLimitSec: body.action === 'submit' ? 10 : 5,
    });

    // Queue full, or the run did not finish inside the request. Nothing ran to
    // completion, so nothing is recorded and no submission is counted — the
    // candidate simply tries again in a moment.
    if (result.busy) {
      return ok({
        runnerAvailable: true,
        busy: true,
        message: 'The code runner is busy right now. Your code is saved — give it a few seconds and run again.',
        results: [],
        passed: 0,
        total: 0,
      });
    }

    // Second chance on formatting for whole-program runs, where Judge0 compared
    // stdout byte-for-byte. Harness runs are compared as values already.
    const reconciled: TestResult[] = signature
      ? result.results
      : result.results.map((r) =>
          r.verdict === 'wrong_answer' && outputsMatch(r.actual, r.expected)
            ? { ...r, verdict: 'passed' as const }
            : r,
        );
    const passed = reconciled.filter((r) => r.verdict === 'passed').length;

    if (body.action === 'submit') {
      // Recorded with the service role: `live_state` is the orchestrator's, and
      // the browser must not be able to write its own test results.
      const admin = createAdminClient();
      const state = (session.live_state ?? {}) as Record<string, unknown>;
      const submissions = Array.isArray(state.coding_submissions) ? state.coding_submissions : [];

      await admin
        .from('sessions')
        .update({
          live_state: {
            ...state,
            coding_submissions: [
              ...submissions,
              {
                challenge_index: body.challengeIndex ?? 0,
                title: challenge.title,
                language,
                source: body.source,
                passed,
                total: reconciled.length,
                pass_rate: reconciled.length > 0 ? passed / reconciled.length : 0,
                compile_error: result.compileError ?? null,
                submitted_at: new Date().toISOString(),
              },
            ],
          },
        })
        .eq('id', sessionId);
    }

    return ok({
      runnerAvailable: true,
      action: body.action,
      // Hidden test bodies are never returned — only the tally. Their inputs are
      // the whole point of hiding them.
      results: body.action === 'submit' ? reconciled.slice(0, visible.length) : reconciled,
      hiddenPassed:
        body.action === 'submit'
          ? reconciled.slice(visible.length).filter((r) => r.verdict === 'passed').length
          : undefined,
      hiddenTotal: body.action === 'submit' ? hidden.length : undefined,
      passed,
      total: reconciled.length,
      compileError: result.compileError,
      log: result.log,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
