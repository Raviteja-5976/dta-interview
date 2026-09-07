/**
 * POST /api/projects — create a project and kick off preparation.
 *
 * sitemap-workflow.md §5:
 *   insert projects (status = 'preparing')   ← returns immediately
 *   insert resumes (version 1), upload to storage
 *   enqueue prep job → P2, P3, P1 in parallel → P4 → P5
 *   redirect to /projects/[id]               ← user lands in ~1s
 *
 * The user is NOT held on a spinner for 30-90 seconds. They land on the Overview
 * page and watch it fill in. The overview page triggers the prep route itself.
 */

import { createSupabaseServerClient, requireUser } from '@/lib/supabase/server';
import { extractResumeText, ResumeExtractionError } from '@/lib/pipelines/resume-text';
import { domainFromUrl } from '@/lib/agents/p1-company';
import { isValidIsoDate } from '@/lib/engine/prep-window';
import { created, failure, handleRouteError } from '@/lib/api/respond';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const form = await request.formData();
    const file = form.get('resume');
    const jdRaw = String(form.get('jd_raw') ?? '').trim();
    const companyName = String(form.get('company_name') ?? '').trim();
    const roleTitle = String(form.get('role_title') ?? '').trim();
    const companyUrl = String(form.get('company_url') ?? '').trim() || null;
    const seniority = String(form.get('seniority') ?? '').trim() || null;
    const interviewDateRaw = String(form.get('interview_date') ?? '').trim();

    /*
     * Optional, and silently dropped when malformed rather than failing the
     * whole creation.
     *
     * Most people do not know the date when they create the project, and the
     * ones who do can set it on the plan tab later. Rejecting a project because
     * a date field was odd would lose the resume upload and the pasted job
     * description along with it, which is a bad trade for a field nothing yet
     * depends on.
     */
    const interviewDate = isValidIsoDate(interviewDateRaw) ? interviewDateRaw : null;

    if (!(file instanceof File)) return failure(400, 'A resume file is required.');
    if (file.size > MAX_RESUME_BYTES) return failure(400, 'That resume is over the 5 MB limit.');
    if (jdRaw.length < 80) {
      return failure(400, 'Paste the full job description — we need more than a job title to build an interview.');
    }
    if (!companyName) return failure(400, 'A company name is required.');
    if (!roleTitle) return failure(400, 'A role title is required.');

    // Extract before writing anything: a scanned PDF should fail here, with the
    // form still populated, rather than leaving an unpreparable project behind.
    let extracted;
    try {
      extracted = await extractResumeText(await file.arrayBuffer());
    } catch (err) {
      if (err instanceof ResumeExtractionError) return failure(422, err.message);
      throw err;
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        company_name: companyName,
        company_domain: domainFromUrl(companyUrl),
        role_title: roleTitle,
        seniority,
        jd_raw: jdRaw,
        interview_date: interviewDate,
        status: 'preparing',
        readiness: {},
        stats: {},
      })
      .select('id')
      .single();

    if (projectError || !project) {
      return failure(500, 'Could not create the project. Your inputs were not lost — try again.');
    }

    const { data: resume, error: resumeError } = await supabase
      .from('resumes')
      .insert({
        user_id: user.id,
        project_id: project.id,
        version: 1,
        label: 'original',
        source: 'upload',
        parsed: { raw_text: extracted.text, page_count: extracted.pageCount },
      })
      .select('id')
      .single();

    if (resumeError || !resume) {
      return failure(500, 'Could not save the resume. Try again.');
    }

    // Storage path carries {user_id} as the first segment so the single storage
    // RLS policy protects it (db-design.md §7).
    const storagePath = `${user.id}/${resume.id}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('resumes')
      .upload(storagePath, file, { contentType: 'application/pdf', upsert: true });

    await supabase
      .from('resumes')
      .update({ file_path: uploadError ? null : storagePath })
      .eq('id', resume.id);

    await supabase
      .from('projects')
      .update({ active_resume_id: resume.id })
      .eq('id', project.id);

    return created({ projectId: project.id, pageCount: extracted.pageCount });
  } catch (err) {
    return handleRouteError(err);
  }
}
