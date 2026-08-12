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
import {
  CODING_MODULE_CREDITS,
  CREDITS_PER_MINUTE,
  SYSTEM_DESIGN_MODULE_CREDITS,
  codingQuestionCount,
  designQuestionCount,
  planSession,
  type Difficulty,
} from '@/lib/credits';
import { created, failure, handleRouteError, notFound } from '@/lib/api/respond';

interface CreateSessionBody {
  projectId: string;
  difficulty?: Difficulty;
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
      defaults?: { difficulty?: Difficulty };
    };

    const difficulty: Difficulty = body.difficulty ?? prefs.defaults?.difficulty ?? 'medium';
    const modules = {
      coding: body.coding ?? false,
      system_design: body.systemDesign ?? false,
      behavioral: true,
    };

    const balance = profile?.credits_balance ?? 0;

    // Duration is derived from difficulty, then capped by what the balance can
    // actually pay for. There is no duration picker — see lib/credits.ts.
    const plan = planSession(difficulty, modules, balance);

    // The gate. Voice is post-paid, so nothing stops a running interview from
    // outspending the balance except this check plus the ceiling it produces.
    // Never let a user reach a live interview screen and then fail (§8).
    if (!plan.canStart) {
      return failure(
        402,
        `An ${difficulty} interview needs ${plan.requiredToStart} credits to start ` +
          `(${plan.minimumVoiceCredits} for its first ${plan.band.min} minutes` +
          `${plan.upfrontCredits > 0 ? `, ${plan.upfrontCredits} for the modules` : ''}) ` +
          `and you have ${balance}.`,
        {
          shortfall: plan.shortfall,
          required: plan.requiredToStart,
          balance,
          difficulty,
          minimumMinutes: plan.band.min,
        },
      );
    }

    const config = {
      difficulty,
      language: prefs.language ?? 'en-IN',
      persona: prefs.persona ?? 'warm_professional',
      modules,
      focus_skills: body.focusSkills ?? [],
      // The hard stop the orchestrator enforces, and the cap that settlement
      // bills against. Stored so both read the same number.
      duration_min: plan.ceilingMinutes,
      // What the interview is planned to fill. P5 targets this range.
      target_min_minutes: plan.band.min,
      target_max_minutes: plan.ceilingMinutes,
    };

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

    // Modules only. They are generated during preparation, so the spend is
    // incurred before a word is spoken and there is nothing to pro-rate.
    // Voice time is charged afterwards, from the real elapsed duration.
    //
    // The conditional UPDATE inside spend_credits is the whole concurrency
    // story: two simultaneous taps cannot both succeed on the last credit.
    if (plan.upfrontCredits > 0) {
      const { error: spendError } = await supabase.rpc('spend_credits', {
        p_amount: plan.upfrontCredits,
        p_session: session.id,
        p_meta: {
          reason: 'modules',
          breakdown: {
            coding: modules.coding ? CODING_MODULE_CREDITS : 0,
            system_design: modules.system_design ? SYSTEM_DESIGN_MODULE_CREDITS : 0,
          },
          difficulty,
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
    }

    await supabase
      .from('sessions')
      .update({ credits_charged: plan.upfrontCredits, status: 'preparing' })
      .eq('id', session.id);

    return created({
      sessionId: session.id,
      seq,
      chargedNow: plan.upfrontCredits,
      ratePerMinute: CREDITS_PER_MINUTE,
      minMinutes: plan.band.min,
      maxMinutes: plan.ceilingMinutes,
      maxTotalCredits: plan.maxTotalCredits,
      ceilingLimitedByCredits: plan.ceilingLimitedByCredits,
      // How many challenges each enabled module will contain, so the interview
      // screen can say so before the candidate is surprised by a third problem.
      codingQuestions: modules.coding
        ? codingQuestionCount(difficulty, plan.ceilingMinutes)
        : 0,
      designQuestions: modules.system_design
        ? designQuestionCount(difficulty, plan.ceilingMinutes)
        : 0,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
