/**
 * POST /api/sessions/[sessionId]/code — run or submit a coding answer.
 *
 * `action: 'run'`    → visible tests only. The candidate's own feedback loop.
 * `action: 'submit'` → visible AND hidden tests, recorded against the session.
 *
 * sitemap §9: hidden test results do not appear until after submission. Showing
 * them during `run` would turn the round into a guessing game against the
 * grader instead of a reasoning exercise.
 */

import type { NextRequest } from 'next/server';

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCodeRunner, outputsMatch, type LanguageId, type TestResult } from '@/lib/execution';
import type { CodingChallenge } from '@/lib/agents/schemas';
import type { ChallengeSet } from '@/lib/agents/p7-challenge';
import { failure, handleRouteError, notFound, ok } from '@/lib/api/respond';

export const maxDuration = 120;

interface CodeBody {
  action: 'run' | 'submit';
  language: LanguageId;
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
    if (!body.source?.trim()) return failure(400, 'There is no code to run.');

    const set = session.coding_challenge as ChallengeSet<CodingChallenge> | null;
    const challenge = set?.challenges?.[body.challengeIndex ?? 0];
    if (!challenge) return failure(409, 'This interview has no coding challenge.');

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
      language: body.language,
      source: body.source,
      tests,
    });

    // Queue full. Nothing ran, so nothing is recorded and no submission is
    // counted — the candidate simply tries again in a moment.
    if (result.busy) {
      return ok({
        runnerAvailable: true,
        busy: true,
        message: 'The code runner is busy right now. Give it a few seconds and run again.',
        results: [],
        passed: 0,
        total: 0,
      });
    }

    // Second chance on formatting. Judge0 compares stdout byte-for-byte, and a
    // correct answer with a trailing newline is not a wrong answer.
    const reconciled: TestResult[] = result.results.map((r) =>
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
                language: body.language,
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
      results:
        body.action === 'submit'
          ? reconciled.slice(0, visible.length)
          : reconciled,
      hiddenPassed:
        body.action === 'submit'
          ? reconciled.slice(visible.length).filter((r) => r.verdict === 'passed').length
          : undefined,
      hiddenTotal: body.action === 'submit' ? hidden.length : undefined,
      passed,
      total: reconciled.length,
      compileError: result.compileError,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
