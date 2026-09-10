/**
 * Phase 1 · Project preparation — P1, P2, P3 in parallel → P4 → P5.
 *
 * Runs once per project, not per session. That split is the whole payoff of the
 * project/session model: the second interview costs seconds of setup and a
 * fraction of the spend, because none of this runs again.
 *
 * Dependency rules from agentdesign.md §2.3:
 *   P1, P2, P3 run in parallel; P4 waits on all three  (cuts prep ~60s → ~25s)
 *   P4 → P5 strictly sequential
 *
 * Failure policy (sitemap-workflow.md §6): P1 is optional. If only company
 * research fails the project is still fully usable and lands in `ready` with an
 * empty Company tab. If P2, P3, P4 or P5 fails the project goes to `failed` with
 * a named stage and a retry.
 *
 * ── How it runs ──────────────────────────────────────────────────────────────
 * As a durable pipeline (lib/ai/durable.ts), one short pass per request from
 * POST /api/projects/[id]/prep. Every pass executes this function from the top:
 * finished calls replay from the run's state and the first unfinished one ends
 * the pass. So nothing is written until the pass that has every result in hand
 * — that is what the `checkpoint()` and the Persist block at the end are for.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// The domain was normalised at project creation and stored on the row, so prep
// reads it rather than deriving it again.
import { runCompanyResearch } from '../agents/p1-company';
import { runResumeParser, runAtsScore } from '../agents/p2-resume';
import { runJdParser } from '../agents/p3-jd';
import { runGapAnalysis } from '../agents/p4-gap';
import { runStrategy } from '../agents/p5-strategy';
import { DIFFICULTY_BANDS } from '../credits';
import type { CompanyProfile } from '../agents/schemas';
import { checkpoint, memo, reportProgress, rethrowIfPending } from '../ai/durable';
import { AgentError } from '../ai/run';

export type PrepStage = 'parsing' | 'company' | 'gap' | 'strategy' | 'done';

export interface PrepResult {
  status: 'ready' | 'failed';
  stage: PrepStage;
  companyResearchSkipped: boolean;
  error?: { stage: PrepStage; message: string };
}

export async function runProjectPrep(
  supabase: SupabaseClient,
  projectId: string,
): Promise<PrepResult> {
  // Explicit column list — never `select *` on projects (db-design.md §1.2).
  const { data: project, error: loadError } = await supabase
    .from('projects')
    .select('id, user_id, company_name, company_domain, role_title, seniority, jd_raw, active_resume_id')
    .eq('id', projectId)
    .single();

  if (loadError || !project) {
    return {
      status: 'failed',
      stage: 'parsing',
      companyResearchSkipped: true,
      error: { stage: 'parsing', message: 'Project not found.' },
    };
  }

  const { data: resume } = await supabase
    .from('resumes')
    .select('id, parsed, file_path, label')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const resumeText = (resume?.parsed as { raw_text?: string } | null)?.raw_text;
  const jdText = project.jd_raw as string | null;

  if (!resumeText || !jdText) {
    return await fail(supabase, projectId, 'parsing', 'Resume text or job description is missing.');
  }

  const context = { userId: project.user_id, projectId };
  let stage: PrepStage = 'parsing';
  let companyResearchSkipped = false;

  try {
    reportProgress('parsing');

    // ── P1 · P2 · P3 · ATS in parallel ───────────────────────────────────────
    //
    // `allSettled` rather than `all`: under a durable run any of these may still
    // be running, and the pass has to start or check every one of them before it
    // stops (durable.ts, rule 3).
    //
    // ATS rides along in the same group. It reads the same two inputs and
    // nothing downstream waits on it, so in parallel it costs no wall clock.
    const domain = project.company_domain ?? null;

    const [resumeOutcome, jdOutcome, companyOutcome, atsOutcome] = await Promise.allSettled([
      runResumeParser({ resumeText }, context),
      runJdParser({ jdText }, context),
      // Memoised so the cache read and the cache write happen once per run,
      // rather than again on every pass while P4 and P5 are still running.
      memo('company_profile', () =>
        loadOrResearchCompany(supabase, {
          companyName: project.company_name,
          domain,
          context,
        }),
      ),
      runAtsScore({ resumeText, jdText }, context),
    ]);
    checkpoint();

    if (resumeOutcome.status === 'rejected') throw resumeOutcome.reason;
    if (jdOutcome.status === 'rejected') throw jdOutcome.reason;

    const resumeProfile = resumeOutcome.value;
    const jdProfile = jdOutcome.value;
    // P1 is optional (see header): anything short of a profile means "no
    // company research", never a failed project.
    const companyProfile = companyOutcome.status === 'fulfilled' ? companyOutcome.value : null;
    // Best-effort, as it always was.
    const ats = atsOutcome.status === 'fulfilled' ? atsOutcome.value : null;

    companyResearchSkipped = companyProfile === null;

    // ── P4 ───────────────────────────────────────────────────────────────────
    stage = 'gap';
    reportProgress('gap');
    const gapReport = await runGapAnalysis(
      { resume: resumeProfile, jd: jdProfile, company: companyProfile },
      context,
    );

    // ── P5 ───────────────────────────────────────────────────────────────────
    // A project-level placeholder strategy at the medium band. The real one is
    // regenerated per session in session-prep.ts, where the difficulty, modules
    // and credit-capped ceiling are actually known. This exists so the Overview
    // page has something to show before the first interview.
    stage = 'strategy';
    reportProgress('strategy');
    const strategy = await runStrategy(
      {
        gap: gapReport,
        jd: jdProfile,
        config: {
          minMinutes: DIFFICULTY_BANDS.medium.min,
          maxMinutes: DIFFICULTY_BANDS.medium.max,
          difficulty: 'medium',
          coding: false,
          skillChallenge: false,
        },
      },
      context,
    );

    // ── Persist ──────────────────────────────────────────────────────────────
    // Only reached on the pass that has every result in hand, so each write
    // below happens once.
    stage = 'done';

    if (resume?.id) {
      await supabase
        .from('resumes')
        .update({
          parsed: { ...(resume.parsed as object), raw_text: resumeText, profile: resumeProfile },
          ats,
        })
        .eq('id', resume.id);
    }

    await supabase
      .from('projects')
      .update({
        company_profile: companyProfile,
        jd_profile: jdProfile,
        gap_report: gapReport,
        strategy,
        seniority: project.seniority ?? jdProfile.seniority,
        status: 'ready',
        prep_error: companyResearchSkipped
          ? { stage: 'company', message: 'Company research unavailable.', recoverable: true }
          : null,
      })
      .eq('id', projectId);

    await seedSkillProgress(supabase, {
      projectId,
      userId: project.user_id,
      gapReport,
    });

    return { status: 'ready', stage: 'done', companyResearchSkipped };
  } catch (err) {
    // Unfinished work is not a failure — the next pass picks it up.
    rethrowIfPending(err);

    const message =
      err instanceof AgentError ? err.message : err instanceof Error ? err.message : 'Preparation failed.';
    return await fail(supabase, projectId, stage, message);
  }
}

/**
 * Company research is cached globally by domain (db-design.md §3.8) — it is the
 * same for every user interviewing at the same company and is the most expensive
 * prep call, so a cache hit here is the single biggest cost saving in Phase 1.
 */
async function loadOrResearchCompany(
  supabase: SupabaseClient,
  args: {
    companyName: string;
    domain: string | null;
    context: { userId: string; projectId: string };
  },
): Promise<CompanyProfile | null> {
  if (!args.domain) return null;

  const { data: cached } = await supabase
    .from('company_cache')
    .select('profile, expires_at')
    .eq('domain', args.domain)
    .maybeSingle();

  if (cached && new Date(cached.expires_at) > new Date()) {
    return cached.profile as CompanyProfile;
  }

  const profile = await runCompanyResearch(
    { companyName: args.companyName, companyUrl: args.domain },
    args.context,
  );

  if (profile) {
    await supabase.from('company_cache').upsert({
      domain: args.domain,
      profile,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
  }

  return profile;
}

/**
 * Seeds `skill_progress` from P4's gap report — the "Claimed" column that
 * sitemap-workflow.md §7 pairs against "Verified". Scores stay null until an
 * interview actually establishes something; a seeded zero would read as
 * "you're bad at this" rather than "not yet measured".
 */
async function seedSkillProgress(
  supabase: SupabaseClient,
  args: { projectId: string; userId: string; gapReport: Awaited<ReturnType<typeof runGapAnalysis>> },
): Promise<void> {
  const rows = args.gapReport.skills.map((s) => ({
    project_id: args.projectId,
    user_id: args.userId,
    skill: s.skill,
    jd_importance: s.jd_importance,
    status: s.status,
    score: null,
    confidence: null,
    depth: null,
    sessions_seen: 0,
    history: [],
  }));

  if (rows.length === 0) return;

  // onConflict on the composite PK: re-running prep updates the claim, it does
  // not wipe the verified progress a previous interview established.
  await supabase.from('skill_progress').upsert(rows, {
    onConflict: 'project_id,skill',
    ignoreDuplicates: true,
  });
}

async function fail(
  supabase: SupabaseClient,
  projectId: string,
  stage: PrepStage,
  message: string,
): Promise<PrepResult> {
  await supabase
    .from('projects')
    .update({
      status: 'failed',
      prep_error: { stage, message, at: new Date().toISOString(), recoverable: true },
    })
    .eq('id', projectId);

  return { status: 'failed', stage, companyResearchSkipped: true, error: { stage, message } };
}
