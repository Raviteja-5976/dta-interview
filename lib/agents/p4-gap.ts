/**
 * P4 · Gap Analysis Agent
 *
 * Joins resume × JD × company and classifies every skill. Its ranking is what
 * P5 allocates time against and what P6 builds goals around, so a mis-ranked
 * gap propagates through the entire interview.
 *
 * Its output also seeds `skill_progress` at project creation — the "Claimed"
 * column that sitemap-workflow.md §7 pairs against "Verified".
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { gapReportSchema, type GapReport } from './schemas';
import type { CompanyProfile, JdProfile, ResumeProfile } from './schemas';

const SYSTEM = `You compare what a candidate claims against what a role needs, and decide what an interview must investigate.

Classify every skill that appears in either the job description or the resume:

- STRONG    — the role needs it and the resume shows real evidence (a project, an outcome, ownership).
- WEAK      — the role needs it and the resume shows thin evidence (listed only, or a passing mention).
- UNVERIFIED— the resume claims it prominently but nothing corroborates the claim. This is the most interesting category and the one an interview is best at resolving.
- MISSING   — the role needs it and the resume does not mention it at all.
- SURPLUS   — the resume has it, the role does not need it. Include these but rank them last.

investigation_priority (0-1) is NOT the same as jd_importance. It is how much an interview would learn by asking. A skill the role needs and the resume proves thoroughly has high importance and LOW investigation priority — there is nothing left to find out. Priority is highest where importance is high and certainty is low.

top_investigations is the ranked answer to "what does this interview exist to find out". Write each as something establishable in conversation, not as a topic:
  good: "Whether the Kubernetes experience is hands-on or observational"
  bad:  "Kubernetes"

If company research is provided, let it shift emphasis — a company whose entire product is real-time will probe concurrency harder than the posting alone suggests. If it is absent, ignore it; do not speculate about the company.`;

export interface GapAnalysisInput {
  resume: ResumeProfile;
  jd: JdProfile;
  company?: CompanyProfile | null;
}

export async function runGapAnalysis(
  input: GapAnalysisInput,
  context?: RunContext,
): Promise<GapReport> {
  const companyBlock = input.company
    ? `<company_profile>\n${JSON.stringify(input.company)}\n</company_profile>`
    : '<company_profile>(none — no company research available, ignore company context)</company_profile>';

  const result = await runAgent({
    agent: 'P4',
    schema: gapReportSchema,
    system: SYSTEM,
    prompt: [
      `<resume_profile>\n${JSON.stringify(input.resume)}\n</resume_profile>`,
      `<jd_profile>\n${JSON.stringify(input.jd)}\n</jd_profile>`,
      companyBlock,
      'Produce the gap analysis.',
    ].join('\n\n'),
    context,
    meta: { had_company: Boolean(input.company) },
  });
  return result.data;
}
