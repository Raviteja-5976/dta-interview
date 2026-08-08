/**
 * POST /api/sessions — spend credits and create an interview session.
 *
 * sitemap-workflow.md §8:
 *   spend_credits(amount, session_id)   ← atomic, fails closed on insufficient balance
 *   insert sessions (status = 'preparing')
 *   enqueue P6 blueprint → P7 coding → P8 voice pre-synthesis
 *   redirect to /interview/[sessionId]
 *
 * `spend_credits` reads `auth.uid()`, so it MUST be called through the user's
 * own client. A service-role call would see a null uid and raise
 * `not_authenticated`.
 */

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { codingQuestionCount, designQuestionCount, quoteSession } from '@/lib/credits';
import { created, failure, handleRouteError, notFound } from '@/lib/api/respond';

interface CreateSessionBody {
  projectId: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  durationMin?: number;
  coding?: boolean;
  systemDesign?: boolean;
  focusSkills?: string[];
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();
    const body = (await request.json()) as CreateSessionBody;

    if (!body.projectId) return failure(400, 'A project is required.');

    const { data: project } = await supabase
      .from('projects')
      .select('id, status, active_resume_id')
      .eq('id', body.projectId)
      .maybeSingle();

    if (!project) return notFound();
    if (project.status !== 'ready') {
      return failure(409, 'This project is still preparing. Start the interview once it is ready.');
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('credits_balance, prefs')
      .eq('id', user.id)
      .single();

    const prefs = (profile?.prefs ?? {}) as {
      language?: string;
      persona?: string;
      defaults?: { difficulty?: 'easy' | 'medium' | 'hard'; duration_min?: number };
    };

    const config = {
      difficulty: body.difficulty ?? prefs.defaults?.difficulty ?? 'medium',
      duration_min: body.durationMin ?? prefs.defaults?.duration_min ?? 15,
      language: prefs.language ?? 'en-IN',
      persona: prefs.persona ?? 'warm_professional',
      modules: {
        coding: body.coding ?? false,
        system_design: body.systemDesign ?? false,
        behavioral: true,
      },
      focus_skills: body.focusSkills ?? [],
    };

    // The HOLD: the most this session could cost, at the full planned duration
    // with every enabled module. Settlement at the end returns whatever went
    // unused, so this is a ceiling, not a price.
    const hold = quoteSession(config.duration_min, config.modules);

    // Checked here for a clear message; `spend_credits` is still the real gate.
    // Never let a user reach a live interview screen and then fail (§8).
    const balance = profile?.credits_balance ?? 0;
    if (balance < hold.total) {
      return failure(
        402,
        `This interview needs up to ${hold.total} credits and you have ${balance}.`,
        {
          shortfall: hold.total - balance,
          required: hold.total,
          balance,
        },
      );
    }

    const { data: lastSession } = await supabase
      .from('sessions')
      .select('seq')
      .eq('project_id', body.projectId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();

    const seq = (lastSession?.seq ?? 0) + 1;

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        project_id: body.projectId,
        resume_id: project.active_resume_id,
        seq,
        status: 'created',
        config,
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      return failure(500, 'Could not create the session. No credits were spent.');
    }

    // The conditional UPDATE inside spend_credits is the whole concurrency
    // story: two simultaneous taps cannot both succeed on the last credit.
    const { error: spendError } = await supabase.rpc('spend_credits', {
      p_amount: hold.total,
      p_session: session.id,
      p_meta: {
        kind: 'hold',
        breakdown: { voice: hold.voice, coding: hold.coding, system_design: hold.system_design },
        rate_per_minute: 5,
        planned_minutes: hold.minutes,
        difficulty: config.difficulty,
      },
    });

    if (spendError) {
      // Fail closed: remove the session so an unpaid one never reaches the
      // interview screen.
      await supabase.from('sessions').delete().eq('id', session.id);

      const insufficient = spendError.message.includes('insufficient_credits');
      return failure(
        insufficient ? 402 : 500,
        insufficient
          ? 'You do not have enough credits for this interview.'
          : 'Could not charge credits. Nothing was spent.',
      );
    }

    await supabase
      .from('sessions')
      .update({ credits_charged: hold.total, status: 'preparing' })
      .eq('id', session.id);

    return created({
      sessionId: session.id,
      seq,
      creditsHeld: hold.total,
      plannedMinutes: hold.minutes,
      // How many challenges each enabled module will contain, so the interview
      // screen can say so before the candidate is surprised by a third problem.
      codingQuestions: config.modules.coding
        ? codingQuestionCount(config.difficulty, config.duration_min)
        : 0,
      designQuestions: config.modules.system_design
        ? designQuestionCount(config.difficulty, config.duration_min)
        : 0,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
