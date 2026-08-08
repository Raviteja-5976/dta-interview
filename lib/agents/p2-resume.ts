/**
 * P2 · Resume Parser Agent
 *
 * Resume text → structured profile. The part that matters is
 * `claims_worth_probing`: agentdesign.md is explicit that this agent exists to
 * find what is worth *testing*, not to produce a skill list. A parser that
 * returns ["Python", "Docker", "Kubernetes"] has done nothing an interview can use.
 */

import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { atsSchema, resumeProfileSchema, type AtsReport, type ResumeProfile } from './schemas';

const SYSTEM = `You are a technical recruiter reading a candidate's resume before an interview.

Extract the structure faithfully — never invent an employer, a date, or a technology that is not in the text.

Your most important output is claims_worth_probing. A claim is worth probing when an interview could learn something real by testing it:
- A quantified outcome with no method attached ("cut latency by 40%") — the number is unverifiable and the reasoning behind it is the interesting part.
- A heavyweight technology listed with no project behind it (Kubernetes, Kafka, Spark) — listing is cheap, and the gap between "used" and "configured" is exactly what an interviewer needs to establish.
- Ownership that reads ambiguously ("worked on", "was part of", "helped build") — these phrases hide the difference between authoring something and standing near it.
- A seniority signal that the described work does not support.

Do NOT flag a claim just because it is impressive. Flag it because its truth is uncertain and testable.

Set evidence for each skill honestly:
- listed_only: appears in a skills section and nowhere else
- mentioned_in_project: appears in the description of specific work
- quantified_outcome: tied to a measurable result

Return only what the resume supports.`;

export async function runResumeParser(
  input: { resumeText: string },
  context?: RunContext,
): Promise<ResumeProfile> {
  const result = await runAgent({
    agent: 'P2',
    schema: resumeProfileSchema,
    system: SYSTEM,
    prompt: `Parse this resume.\n\n<resume>\n${input.resumeText}\n</resume>`,
    context,
    meta: { resume_chars: input.resumeText.length },
    // No fallback: a project cannot be prepared without a parsed resume, so this
    // must surface as status='failed' with a retry rather than degrade silently.
  });
  return result.data;
}

const ATS_SYSTEM = `You score a resume for applicant-tracking-system compatibility against a specific job description.

Score honestly and specifically. A generic "add more keywords" is useless.

- keyword_coverage is the fraction of the JD's required skills that appear anywhere in the resume text.
- missing_keywords are terms from the JD that an ATS would look for and not find. Only list terms the candidate could plausibly and truthfully add.
- formatting.issues are structural problems that break parsers: multi-column layouts, tables, text in images, unusual section headings, dates in ambiguous formats.
- Section scores reflect substance, not length.`;

export async function runAtsScore(
  input: { resumeText: string; jdText: string },
  context?: RunContext,
): Promise<AtsReport> {
  const result = await runAgent({
    agent: 'P2',
    schema: atsSchema,
    system: ATS_SYSTEM,
    prompt: `<resume>\n${input.resumeText}\n</resume>\n\n<job_description>\n${input.jdText}\n</job_description>\n\nScore the resume against this posting.`,
    context,
    meta: { step: 'ats' },
  });
  return result.data;
}
