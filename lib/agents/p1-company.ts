/**
 * P1 · Company Research Agent
 *
 * The one prep agent that reads the outside world. The page fetch happens here
 * in plain code rather than through a provider's built-in web-search tool —
 * those tools differ per provider and would make P1 the one agent that cannot
 * follow AI_PROVIDER. Fetching ourselves keeps it portable.
 *
 * Results are cached in `company_cache` by domain (db-design.md §3.8): company
 * research is identical for every user interviewing at the same company and is
 * the most expensive prep call, so the cache is what makes P1 affordable.
 */

import { memo } from '../ai/durable';
import { runAgent } from '../ai/run';
import type { RunContext } from '../ai/types';
import { companyProfileSchema, type CompanyProfile } from './schemas';

/** Engineering blogs and careers pages carry the stack and culture signal a homepage does not. */
const EXTRA_PATHS = ['/careers', '/blog', '/engineering'];

const SYSTEM = `You are researching a company so an interview can sound like it came from someone who works there.

You are given text scraped from the company's own site. Prefer it over anything you recall — your training data may be stale, and the site is what the candidate can actually read.

Rules:
- Every tech_stack entry and culture signal needs a source: the page title or URL it came from. If you are inferring from general knowledge rather than the provided text, set confidence at or below 0.5 and say so in the source field ("general knowledge, unverified").
- Do not invent products, funding, headcount, or news. "unknown" is a valid size_estimate and an empty recent_news array is a valid answer.
- interview_emphasis is the payoff: given what this company builds and how they describe their engineering, what would their interviewers actually dig into? Be concrete. "Strong CS fundamentals" is worthless; "event-driven consistency, because their entire payments path is asynchronous" is useful.
- overall_confidence should be low when the scraped text was thin.`;

const MAX_PAGE_CHARS = 24_000;

/** Fetches a page and strips it to rough text. Best-effort; failure is fine. */
async function fetchSiteText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'DevTrackAcademy-InterviewPrep/1.0' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 200 ? text.slice(0, MAX_PAGE_CHARS) : null;
  } catch {
    return null;
  }
}

export interface CompanyResearchInput {
  companyName: string;
  companyUrl?: string | null;
}

/**
 * Returns null when there is nothing to research and nothing was learned.
 * A null here is not a failure: sitemap-workflow.md §6 says a project whose P1
 * was skipped is still fully usable, and the Company tab shows an empty state.
 */
export async function runCompanyResearch(
  input: CompanyResearchInput,
  context?: RunContext,
): Promise<CompanyProfile | null> {
  const pages: string[] = [];

  if (input.companyUrl) {
    const base = normaliseUrl(input.companyUrl);

    /*
     * Fetched in parallel, once per run.
     *
     * In parallel because four best-effort fetches at ten seconds each, one
     * after another, could spend a whole 30-second request on their own.
     *
     * Memoised because under a durable run (lib/ai/durable.ts) this function
     * executes on every pass until P1 lands. A page re-scraped on each pass that
     * differs by a single byte — a timestamp, a rotating banner — is a different
     * prompt, and so a different call, started again from nothing every time.
     */
    const [home, ...extras] = await memo(`p1:site:${base}`, () =>
      Promise.all([fetchSiteText(base), ...EXTRA_PATHS.map((path) => fetchSiteText(`${base}${path}`))]),
    );

    if (home) pages.push(`<page url="${base}">\n${home}\n</page>`);
    EXTRA_PATHS.forEach((path, i) => {
      const text = extras[i];
      if (text && pages.length < 3) {
        pages.push(`<page url="${base}${path}">\n${text.slice(0, 8_000)}\n</page>`);
      }
    });
  }

  const scraped = pages.length > 0 ? pages.join('\n\n') : '(no site text could be retrieved)';

  const result = await runAgent({
    agent: 'P1',
    schema: companyProfileSchema,
    system: SYSTEM,
    prompt: `Company: ${input.companyName}\nSite: ${input.companyUrl ?? '(none provided)'}\n\n<scraped_text>\n${scraped}\n</scraped_text>\n\nBuild the company profile.`,
    context,
    meta: { pages_fetched: pages.length, had_url: Boolean(input.companyUrl) },
    // P1 is optional by design — the project stays usable without it, so a
    // failure degrades to "no company research" rather than failing prep.
    fallback: () => null as unknown as CompanyProfile,
  });

  return result.fromFallback ? null : result.data;
}

function normaliseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Bare domain for the `company_cache` primary key. */
export function domainFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(normaliseUrl(raw)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}
