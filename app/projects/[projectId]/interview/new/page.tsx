/**
 * /projects/[projectId]/interview/new — interview setup (sitemap-workflow.md §8).
 *
 * The last screen before a credit is spent. It must be unambiguous.
 *
 * Two rules drive the design:
 *   1. The cost panel is always visible and updates live. Every number on it
 *      comes from `planSession`, the same function the API charges with.
 *   2. Microphone permission is requested HERE, not on the interview screen. A
 *      permission prompt in a live interview costs the first thirty seconds.
 */

'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Mic, MicOff, Play, ShoppingCart } from 'lucide-react';

import AppHeader from '@/components/layout/AppHeader';
import { Button, Card, Chip, ErrorCard, Eyebrow, SectionTitle, Skeleton } from '@/components/app/ui';
import {
  CODING_MODULE_CREDITS,
  DIFFICULTY_BANDS,
  CREDITS_PER_MINUTE,
  SYSTEM_DESIGN_MODULE_CREDITS,
  codingQuestionCount,
  designQuestionCount,
  planSession,
  type Difficulty,
} from '@/lib/credits';
import { supabase } from '@/lib/supabase/client';

/** `?focus=` is read with useSearchParams, which needs a Suspense boundary. */
export default function InterviewSetupPage() {
  return (
    <Suspense
      fallback={
        <Page>
          <Skeleton className="h-96" />
        </Page>
      }
    >
      <InterviewSetupContent />
    </Suspense>
  );
}

function InterviewSetupContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const search = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [coding, setCoding] = useState(false);
  const [systemDesign, setSystemDesign] = useState(false);
  const [focusSkills, setFocusSkills] = useState<string[]>(
    search.get('focus')?.split(',').filter(Boolean) ?? [],
  );

  // Length follows difficulty, then gets capped by what the balance affords.
  // There is no duration picker — see lib/credits.ts for why.
  const plan = planSession(difficulty, { coding, system_design: systemDesign }, balance);
  const canAfford = plan.canStart;

  const codingQs = codingQuestionCount(difficulty, plan.ceilingMinutes);
  const designQs = designQuestionCount(difficulty, plan.ceilingMinutes);

  // ── Mic pre-flight ─────────────────────────────────────────────────────────
  const [micState, setMicState] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [micLevel, setMicLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const requestMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicState('granted');

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        // RMS around the 128 midpoint — a real level meter, not a decoration.
        const rms = Math.sqrt(
          data.reduce((acc, v) => acc + (v - 128) ** 2, 0) / data.length,
        );
        setMicLevel(Math.min(1, rms / 40));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMicState('denied');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();

      const [{ data: profile }, { data: project }, { data: skills }] = await Promise.all([
        auth.user
          ? supabase.from('profiles').select('credits_balance, prefs').eq('id', auth.user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('projects').select('company_name, seniority').eq('id', projectId).maybeSingle(),
        supabase.from('skill_progress').select('skill').eq('project_id', projectId).limit(30),
      ]);

      setBalance(profile?.credits_balance ?? 0);
      setCompanyName(project?.company_name ?? '');
      setAvailableSkills(((skills as Array<{ skill: string }>) ?? []).map((s) => s.skill));

      const prefs = (profile?.prefs ?? {}) as {
        defaults?: { difficulty?: Difficulty; duration_min?: number; coding?: boolean; system_design?: boolean };
      };
      if (prefs.defaults?.difficulty) setDifficulty(prefs.defaults.difficulty);
      if (prefs.defaults?.coding !== undefined) setCoding(prefs.defaults.coding);

      // System design defaults off below mid seniority (§8).
      const senior = ['senior', 'staff', 'principal'].includes(project?.seniority ?? '');
      setSystemDesign(senior && (prefs.defaults?.system_design ?? false));

      setLoading(false);
    })();
  }, [projectId]);

  async function start() {
    setStarting(true);
    setError(null);

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, difficulty, coding, systemDesign, focusSkills }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Could not start the interview. No credits were spent.');
        setStarting(false);
        return;
      }

      router.push(`/interview/${data.sessionId}`);
    } catch {
      setError('Could not reach the server. No credits were spent.');
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <Page>
        <Skeleton className="h-96" />
      </Page>
    );
  }

  return (
    <Page>
      <Eyebrow>Interview setup</Eyebrow>
      <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B] mt-2 mb-8">
        {companyName ? `Ready for ${companyName}?` : 'Set up your interview'}
      </h1>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-6">
            <SectionTitle>Shape of the interview</SectionTitle>

            {/* Difficulty sets the length too. There is no duration picker:
                a hard interview needs room to go deep, and an easy one padded
                out just repeats itself. */}
            <Choice label="Difficulty">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                <Pill key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>
                  {d} · {DIFFICULTY_BANDS[d].min}-{DIFFICULTY_BANDS[d].max} min
                </Pill>
              ))}
            </Choice>

            <p className="-mt-2 mb-5 text-sm text-[#1B1F3B]/70">
              {difficulty === 'easy'
                ? 'A warm-up. Fundamentals and your own projects, at a comfortable pace.'
                : difficulty === 'medium'
                  ? 'A realistic screen. Follow-ups get pointed and claims get tested.'
                  : 'A senior bar. Trade-offs, edge cases, and pressure on anything vague.'}{' '}
              {plan.ceilingLimitedByCredits && (
                <span className="text-[#1B1F3B]">
                  Your balance covers {plan.ceilingMinutes} minutes of it — it will end there.
                </span>
              )}
            </p>

            <Choice label="Modules">
              <Pill active={coding} onClick={() => setCoding(!coding)}>
                Coding round {coding ? '✓' : ''}
              </Pill>
              <Pill active={systemDesign} onClick={() => setSystemDesign(!systemDesign)}>
                System design {systemDesign ? '✓' : ''}
              </Pill>
            </Choice>

            {availableSkills.length > 0 && (
              <Choice label="Focus skills (optional)">
                {availableSkills.slice(0, 12).map((s) => (
                  <Pill
                    key={s}
                    active={focusSkills.includes(s)}
                    onClick={() =>
                      setFocusSkills((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                      )
                    }
                  >
                    {s}
                  </Pill>
                ))}
              </Choice>
            )}
          </Card>

          {/* Pre-flight */}
          <Card className="p-6">
            <SectionTitle sub="We ask for your microphone here so a permission prompt never interrupts the interview.">
              Sound check
            </SectionTitle>

            {micState === 'idle' && (
              <Button variant="secondary" onClick={requestMic}>
                <Mic className="w-4 h-4" /> Test my microphone
              </Button>
            )}

            {micState === 'granted' && (
              <div>
                <p className="font-[family-name:var(--font-display)] font-bold text-sm mb-3">
                  Say something to test it.
                </p>
                <div className="h-6 bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-full overflow-hidden">
                  <div
                    style={{ width: `${micLevel * 100}%`, backgroundColor: micLevel > 0.08 ? '#6EE7B7' : '#FFC93C' }}
                    className="h-full transition-[width] duration-75"
                  />
                </div>
                <p className="mt-2 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                  {micLevel > 0.08 ? 'We can hear you.' : 'Waiting for sound…'}
                </p>
              </div>
            )}

            {micState === 'denied' && (
              <ErrorCard
                heading="Microphone blocked"
                body="Your browser is blocking the microphone. Click the padlock or camera icon in the address bar, set Microphone to Allow, then reload this page. On macOS also check System Settings → Privacy & Security → Microphone."
              />
            )}

            <div className="mt-5 space-y-2 text-sm text-[#1B1F3B]/75">
              <p>
                <strong>Headphones recommended</strong> — they stop the interviewer&apos;s voice being picked up
                as your answer.
              </p>
              <p>Find somewhere quiet. Background conversation confuses the transcript.</p>
              {coding && (
                <p className="text-[#1B1F3B]">
                  <strong>Coding rounds are much better on a laptop</strong> than a phone.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Cost panel — sticky, always visible */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6" accent={canAfford ? 'orange' : 'coral'}>
            <Eyebrow>What this costs</Eyebrow>

            {/* Two billing models, shown separately, because conflating them is
                what makes a bill feel like a surprise. */}
            <div className="mt-4">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 mb-2">
                Charged now
              </p>

              <div className="space-y-2 font-[family-name:var(--font-mono)] text-sm">
                <div className="flex justify-between">
                  <span className="text-[#1B1F3B]/70">
                    Coding round
                    {coding && (
                      <span className="block text-[11px] text-[#1B1F3B]/45">
                        {codingQs} problem{codingQs === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums font-bold">
                    {coding ? CODING_MODULE_CREDITS : '—'}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-[#1B1F3B]/70">
                    System design
                    {systemDesign && (
                      <span className="block text-[11px] text-[#1B1F3B]/45">
                        {designQs} scenario{designQs === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums font-bold">
                    {systemDesign ? SYSTEM_DESIGN_MODULE_CREDITS : '—'}
                  </span>
                </div>

                <div className="flex justify-between font-bold border-t-2 border-[#1B1F3B]/20 pt-2">
                  <span>{plan.upfrontCredits > 0 ? 'Upfront' : 'Nothing upfront'}</span>
                  <span className="tabular-nums">{plan.upfrontCredits}</span>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55 mb-2">
                Charged as you talk
              </p>

              <div className="space-y-2 font-[family-name:var(--font-mono)] text-sm">
                <div className="flex justify-between">
                  <span className="text-[#1B1F3B]/70">
                    {CREDITS_PER_MINUTE} credits per minute
                    <span className="block text-[11px] text-[#1B1F3B]/45">
                      runs {plan.band.min}-{plan.ceilingMinutes} min, then stops
                    </span>
                  </span>
                  <span className="tabular-nums font-bold">
                    {plan.band.min * CREDITS_PER_MINUTE}-{plan.ceilingMinutes * CREDITS_PER_MINUTE}
                  </span>
                </div>

                <div className="flex justify-between border-t-2 border-[#1B1F3B] pt-2 font-bold">
                  <span>Most it can cost</span>
                  <span className="tabular-nums">{plan.maxTotalCredits}</span>
                </div>
                <div className="flex justify-between text-[#1B1F3B]/70">
                  <span>Your balance</span>
                  <span className="tabular-nums">{balance}</span>
                </div>
              </div>
            </div>

            <p className="mt-4 p-3 bg-[#6EE7B7]/25 border-2 border-[#1B1F3B] rounded-2xl text-xs text-[#1B1F3B]">
              Nothing is held. Stop after{' '}
              {Math.max(1, Math.round(plan.ceilingMinutes * 0.4))} minutes and you pay{' '}
              <strong className="tabular-nums">
                {Math.max(1, Math.round(plan.ceilingMinutes * 0.4)) * CREDITS_PER_MINUTE}
              </strong>{' '}
              credits for the time — not a credit more.
            </p>

            {error && (
              <div className="mt-4">
                <ErrorCard heading="Couldn't start" body={error} />
              </div>
            )}

            <div className="mt-5">
              {canAfford ? (
                <Button
                  onClick={start}
                  disabled={micState !== 'granted' || starting}
                  className="w-full"
                  title={micState !== 'granted' ? 'Test your microphone first' : undefined}
                >
                  <Play className="w-4 h-4" />
                  {starting ? 'Starting…' : 'Start interview'}
                </Button>
              ) : (
                /* Never let a user reach a live interview screen and then fail (§8). */
                <Button
                  href={`/credits?next=/projects/${projectId}/interview/new`}
                  variant="secondary"
                  className="w-full"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Buy {plan.shortfall} more credit{plan.shortfall === 1 ? '' : 's'}
                </Button>
              )}
            </div>

            {micState !== 'granted' && canAfford && (
              <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 flex items-center gap-1.5">
                <MicOff className="w-3.5 h-3.5" /> Test your microphone to enable Start.
              </p>
            )}

            <div className="mt-4 pt-4 border-t-2 border-[#1B1F3B]/15">
              <Chip>Modules upfront · time afterwards</Chip>
              <p className="mt-2 text-xs text-[#1B1F3B]/60">
                An {difficulty} interview needs {plan.requiredToStart} credits to start. If the
                interview or its report fails, every credit comes straight back.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <p className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.18em] text-[#1B1F3B]/60 mb-2">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Pill({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-bold uppercase tracking-wide transition-all ${
        active ? 'bg-[#FF6B35] text-white shadow-[2px_2px_0_#1B1F3B]' : 'bg-white text-[#1B1F3B]'
      }`}
    >
      {children}
    </button>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <AppHeader />
      <main className="max-w-[1100px] mx-auto px-4 md:px-8 py-8">{children}</main>
    </div>
  );
}
