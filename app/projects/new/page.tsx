/**
 * /projects/new — the four-step creation wizard (sitemap-workflow.md §5).
 *
 * One step per screen, back always available. Nothing about the interview itself
 * is asked here: difficulty, duration and modules are chosen per session at
 * /interview/new, because a project outlives its settings.
 *
 * On submit the project is created in `preparing` and the user lands on the
 * Overview page in about a second. They are never held on a 30-90s spinner.
 */

'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, FileText, Upload, Check } from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import { Button, Card, Chip, Eyebrow, ErrorCard } from '@/components/app/ui';

const STEPS = ['Resume', 'Job description', 'Company', 'Details'];

export default function NewProjectPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [jdRaw, setJdRaw] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [seniority, setSeniority] = useState('mid');

  const canAdvance = [
    file !== null,
    jdRaw.trim().length >= 80,
    true, // company URL is optional, visibly so
    companyName.trim().length > 0 && roleTitle.trim().length > 0,
  ][step];

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    const form = new FormData();
    form.set('resume', file!);
    form.set('jd_raw', jdRaw);
    form.set('company_name', companyName);
    form.set('role_title', roleTitle);
    form.set('company_url', companyUrl);
    form.set('seniority', seniority);

    try {
      const res = await fetch('/api/projects', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        // Never clear a form the user spent two minutes filling (§5).
        setError(data.error ?? 'Could not create the project. Your inputs are still here — try again.');
        setSubmitting(false);
        return;
      }

      router.push(`/projects/${data.projectId}`);
    } catch {
      setError('Could not reach the server. Your inputs are still here — try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <AppHeader />

      <main className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <Eyebrow>New interview project</Eyebrow>
        <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-5xl font-extrabold text-[#1B1F3B] mt-2 mb-8">
          Set up the job you&apos;re actually interviewing for.
        </h1>

        {/* Step rail */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={`flex-1 h-3 rounded-full border-2 border-[#1B1F3B] transition-colors ${
                  i < step ? 'bg-[#6EE7B7]' : i === step ? 'bg-[#FF6B35]' : 'bg-white'
                }`}
                title={label}
              />
            </div>
          ))}
        </div>

        <Card className="p-6 md:p-8">
          <Chip>{`Step ${step + 1} of 4 · ${STEPS[step]}`}</Chip>

          {/* ── Step 1 · Resume ─────────────────────────────────────────── */}
          {step === 0 && (
            <div className="mt-5">
              <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold mb-1">
                Upload your resume
              </h2>
              <p className="text-sm text-[#1B1F3B]/70 mb-5">
                PDF, up to 5 MB. We pull out your skills, projects, and the claims worth probing.
              </p>

              <input
                ref={fileInput}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />

              <button
                onClick={() => fileInput.current?.click()}
                className="w-full border-4 border-dashed border-[#1B1F3B] rounded-3xl p-10 bg-[#F5EBE0] hover:bg-white transition-colors text-center"
              >
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="w-8 h-8 text-[#FF6B35]" />
                    <span className="font-[family-name:var(--font-display)] font-bold text-[#1B1F3B]">
                      {file.name}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · click to replace
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-[#1B1F3B]/50" />
                    <span className="font-[family-name:var(--font-display)] font-bold text-[#1B1F3B]">
                      Choose a PDF
                    </span>
                    <span className="text-xs text-[#1B1F3B]/60">
                      A text-based PDF, not a scan — we need to read the words.
                    </span>
                  </div>
                )}
              </button>
            </div>
          )}

          {/* ── Step 2 · Job description ────────────────────────────────── */}
          {step === 1 && (
            <div className="mt-5">
              <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold mb-1">
                Paste the job posting
              </h2>
              <p className="text-sm text-[#1B1F3B]/70 mb-5">
                The whole thing. We separate what&apos;s required from what&apos;s nice-to-have.
              </p>

              <textarea
                value={jdRaw}
                onChange={(e) => setJdRaw(e.target.value)}
                rows={12}
                placeholder="Paste the full job description here…"
                className="w-full p-4 bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-2xl font-[family-name:var(--font-body)] text-sm text-[#1B1F3B] placeholder:text-[#1B1F3B]/40 focus:outline-none focus:bg-white resize-y"
              />
              <p className="mt-2 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                {jdRaw.trim().length} characters
                {jdRaw.trim().length > 0 && jdRaw.trim().length < 80 && ' · we need a bit more than a job title'}
              </p>
            </div>
          )}

          {/* ── Step 3 · Company (optional) ─────────────────────────────── */}
          {step === 2 && (
            <div className="mt-5">
              <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold mb-1">
                Company site
              </h2>
              <p className="text-sm text-[#1B1F3B]/70 mb-5">
                We read what they build so the questions sound like they came from them.
              </p>

              {/* Marked optional visibly — an optional field presented as
                  required costs signups (home-page.md §03). */}
              <div className="border-4 border-dashed border-[#1B1F3B] rounded-2xl p-5 bg-[#F5EBE0]/50">
                <div className="flex items-center gap-2 mb-3">
                  <Chip accent="sky">Optional</Chip>
                  <span className="text-xs text-[#1B1F3B]/60">Skip it — the interview works fine without.</span>
                </div>
                <input
                  value={companyUrl}
                  onChange={(e) => setCompanyUrl(e.target.value)}
                  placeholder="stripe.com"
                  className="w-full px-4 py-3 bg-white border-4 border-[#1B1F3B] rounded-2xl font-[family-name:var(--font-mono)] text-sm focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* ── Step 4 · Details ────────────────────────────────────────── */}
          {step === 3 && (
            <div className="mt-5 space-y-5">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold mb-1">
                  Last bit
                </h2>
                <p className="text-sm text-[#1B1F3B]/70">
                  Difficulty and modules are chosen per interview, not here.
                </p>
              </div>

              <Field label="Company name">
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Stripe"
                  className="w-full px-4 py-3 bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-2xl text-sm focus:outline-none focus:bg-white"
                />
              </Field>

              <Field label="Role title">
                <input
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="Backend Engineer"
                  className="w-full px-4 py-3 bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-2xl text-sm focus:outline-none focus:bg-white"
                />
              </Field>

              <Field label="Seniority">
                <div className="flex flex-wrap gap-2">
                  {['intern', 'junior', 'mid', 'senior', 'staff'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSeniority(s)}
                      className={`px-4 py-2 rounded-full border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-bold uppercase transition-colors ${
                        seniority === s ? 'bg-[#FF6B35] text-white' : 'bg-white text-[#1B1F3B]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {error && (
            <div className="mt-6">
              <ErrorCard heading="That didn't go through" body={error} />
            </div>
          )}

          {/* Nav */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || submitting}
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>

            {step < 3 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={!canAdvance || submitting}>
                {submitting ? 'Creating…' : 'Generate project'} <Check className="w-4 h-4" />
              </Button>
            )}
          </div>
        </Card>

        <p className="mt-4 text-center font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50">
          Setup takes about 60 seconds. Preparation runs in the background — you can close the tab.
        </p>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[#1B1F3B]/60 mb-2">
        {label}
      </span>
      {children}
    </label>
  );
}
