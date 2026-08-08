/**
 * RI · Resume Improvement Agent
 *
 * sitemap-workflow.md §7: writes a new `resumes` row at version + 1. It never
 * overwrites, which is what makes the ATS delta on the compare page meaningful.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import {
  resumeSuggestionsSchema,
  type AtsReport,
  type JdProfile,
  type ResumeSuggestions,
} from './schemas';

const SYSTEM = `You rewrite parts of a resume so it lands better against one specific job posting.

Hard rule: you may not invent experience. Every improved line must be a rewrite of something the candidate actually wrote. You may sharpen, reorder, quantify what they already implied, and use the posting's vocabulary for something they already described — you may not add a skill, a job, or an outcome that is not there.

What actually moves the needle, in order:
1. Lead each bullet with the outcome, not the activity. "Reduced p99 latency 40% by replacing N+1 queries with a single join" beats "Responsible for optimising database queries".
2. Use the posting's own terms for things the candidate already does. If they wrote "containerised the service" and the posting says "Docker", say Docker — same fact, matched vocabulary.
3. Quantify what is quantifiable. If they mention scale or improvement without a number and the number is implied elsewhere, surface it.
4. Cut what does not serve this application.

For each suggestion give the original text verbatim so the compare view can diff it.

projected_ats_gain should be conservative and honest. Vocabulary alignment moves an ATS score meaningfully; rewording a summary does not.`;

export interface ResumeImprovementInput {
  resumeText: string;
  jd: JdProfile;
  ats: AtsReport;
}

export async function runResumeImprovement(
  input: ResumeImprovementInput,
  context?: RunContext,
): Promise<ResumeSuggestions> {
  const result = await runAgent({
    agent: 'RI',
    schema: resumeSuggestionsSchema,
    system: SYSTEM,
    prompt: [
      `<resume>\n${input.resumeText}\n</resume>`,
      `<target_role>\n${input.jd.role_title} (${input.jd.seniority})\nRequired: ${input.jd.required_skills.map((s) => s.skill).join(', ')}\n</target_role>`,
      `<ats>\nScore ${input.ats.score}/100 · missing keywords: ${input.ats.missing_keywords.join(', ')}\nFormatting issues: ${input.ats.formatting.issues.join('; ') || 'none'}\n</ats>`,
      '',
      'Suggest improvements.',
    ].join('\n'),
    context,
  });

  return result.data;
}
