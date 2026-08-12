/**
 * /pricing — credits and packs (sitemap-workflow.md §2).
 *
 * Public. Deliberately NOT a feature comparison matrix: there is one product and
 * one kind of credit, and a fake tier table invites a comparison you lose.
 *
 * The job of this page is to make "5 credits a minute" concrete before anyone
 * has to do arithmetic in their head.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Zap } from 'lucide-react';

import Navbar from '@/components/sections/Navbar';
import Footer from '@/components/sections/Footer';
import { Card, Chip, Eyebrow } from '@/components/app/ui';
import {
  CODING_MODULE_CREDITS,
  CREDITS_PER_MINUTE,
  CREDIT_PACKS,
  DIFFICULTY_BANDS,
  SYSTEM_DESIGN_MODULE_CREDITS,
  planSession,
  type Difficulty,
} from '@/lib/credits';
import { paymentsEnabled } from '@/components/app/useRazorpayCheckout';
import { supabase } from '@/lib/supabase/client';

/**
 * Worked examples, computed by the same function the API charges with. A large
 * balance is passed so the numbers show the difficulty band rather than what
 * some hypothetical wallet could afford.
 */
const RICH = 10_000;

const EXAMPLES: Array<{ label: string; difficulty: Difficulty; coding: boolean; design: boolean }> = [
  { label: 'Easy interview', difficulty: 'easy', coding: false, design: false },
  { label: 'Medium + coding round', difficulty: 'medium', coding: true, design: false },
  { label: 'Hard + coding + system design', difficulty: 'hard', coding: true, design: true },
];

const FAQ = [
  {
    q: 'How are credits actually charged?',
    a: `Talking time is billed by the minute, afterwards — ${CREDITS_PER_MINUTE} credits for each minute you were actually in the interview. Nothing is held upfront for it. Coding rounds and system design are the exception: those are charged when you start, because we build the problems before you arrive.`,
  },
  {
    q: 'What if I finish early?',
    a: 'You pay for the minutes you used and nothing else. Walk out after four minutes and it costs four minutes — there is no held amount to give back, because we never took one.',
  },
  {
    q: 'What does the coding round cost?',
    a: `${CODING_MODULE_CREDITS} credits, flat, however many problems it contains. Depending on the length and difficulty of the interview that's one, two, or three problems — never more than three.`,
  },
  {
    q: 'And system design?',
    a: `${SYSTEM_DESIGN_MODULE_CREDITS} credits, flat, on the same basis — up to three scenarios depending on length and difficulty.`,
  },
  {
    q: 'How long is an interview?',
    a: `Difficulty decides it. Easy runs ${DIFFICULTY_BANDS.easy.min}-${DIFFICULTY_BANDS.easy.max} minutes, medium ${DIFFICULTY_BANDS.medium.min}-${DIFFICULTY_BANDS.medium.max}, hard ${DIFFICULTY_BANDS.hard.min}-${DIFFICULTY_BANDS.hard.max}. There is no duration picker: a hard interview needs the room to go deep, and an easy one stretched to half an hour just repeats itself.`,
  },
  {
    q: 'How many credits do I need to start?',
    a: `Enough for the interview's shortest length — ${DIFFICULTY_BANDS.easy.min * CREDITS_PER_MINUTE} credits for easy, ${DIFFICULTY_BANDS.medium.min * CREDITS_PER_MINUTE} for medium, ${DIFFICULTY_BANDS.hard.min * CREDITS_PER_MINUTE} for hard, plus any modules. If your balance covers less than the full length, the interview simply ends when your credits run out rather than running up a debt.`,
  },
  {
    q: 'What happens if an interview fails?',
    a: 'You get every credit back automatically, and you will see the refund on your credits page. A failed interview or a failed report never costs you anything.',
  },
  { q: 'Do credits expire?', a: 'No. Buy them now, use them the week before your interview.' },
];

export default function PricingPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
  }, []);

  // Signed-out visitors need to make an account before they can buy, and the
  // `next` param carries them straight back here afterwards.
  const buyHref = signedIn ? '/credits' : '/auth?next=/credits';

  return (
    <main className="min-h-screen bg-[#FFF8F0] text-[#1B1F3B]">
      <Navbar />

      <section className="max-w-[1100px] mx-auto px-4 md:px-8 pt-12 pb-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-6xl font-extrabold mt-3 leading-[1.05]">
            Pay for the minutes you actually talk.
          </h1>
          <p className="mt-4 text-base md:text-lg text-[#1B1F3B]/75">
            No subscription. No expiry. {CREDITS_PER_MINUTE} credits a minute, billed after you
            finish — so stopping early simply costs less.
          </p>
        </div>

        {/* Packs */}
        <div className="grid md:grid-cols-3 gap-5 mb-16">
          {CREDIT_PACKS.map((pack, i) => (
            <Card
              key={pack.id}
              className={`p-6 flex flex-col ${pack.popular ? 'md:-translate-y-3' : ''}`}
              accent={pack.popular ? 'orange' : undefined}
              tilt={i === 0 ? -1 : i === 2 ? 1 : 0}
            >
              {pack.popular && (
                <div className="mb-3">
                  <Chip accent="yellow">Most popular</Chip>
                </div>
              )}

              <h2 className="font-[family-name:var(--font-display)] text-xl font-extrabold">
                {pack.name}
              </h2>
              <p className="text-sm text-[#1B1F3B]/70 mt-1">{pack.tagline}</p>

              <div className="flex items-baseline gap-1 mt-5">
                <span className="font-[family-name:var(--font-display)] text-5xl font-extrabold tabular-nums">
                  ₹{pack.priceInr}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-2 font-[family-name:var(--font-mono)] text-sm font-bold text-[#FF6B35]">
                <Zap className="w-4 h-4 fill-current" />
                <span className="tabular-nums">{pack.credits} credits</span>
              </div>

              <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/55 mt-1 tabular-nums">
                ≈ {Math.floor(pack.credits / CREDITS_PER_MINUTE)} minutes of interview
              </p>

              <Link
                href={buyHref}
                className={`mt-6 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border-4 border-[#1B1F3B] font-[family-name:var(--font-display)] font-bold text-sm shadow-[4px_4px_0_#1B1F3B] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#1B1F3B] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_#1B1F3B] ${
                  pack.popular ? 'bg-[#FF6B35] text-white' : 'bg-white text-[#1B1F3B]'
                }`}
              >
                Buy credits
              </Link>
            </Card>
          ))}
        </div>

        {/* What a credit buys — the concrete bit */}
        <Card className="p-6 md:p-8 mb-10">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold mb-1">
            What an interview actually costs
          </h2>
          <p className="text-sm text-[#1B1F3B]/70 mb-6">
            Difficulty sets the length. These come from the same code that charges your account.
          </p>

          <div className="space-y-3">
            {EXAMPLES.map((ex) => {
              const plan = planSession(ex.difficulty, { coding: ex.coding, system_design: ex.design }, RICH);
              const low = plan.upfrontCredits + plan.band.min * CREDITS_PER_MINUTE;
              return (
                <div
                  key={ex.label}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-2xl"
                >
                  <span className="font-[family-name:var(--font-display)] font-bold text-sm">
                    {ex.label}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 tabular-nums">
                      {plan.band.min}-{plan.band.max} min × {CREDITS_PER_MINUTE}
                      {ex.coding ? ` +${CODING_MODULE_CREDITS}` : ''}
                      {ex.design ? ` +${SYSTEM_DESIGN_MODULE_CREDITS}` : ''}
                    </span>
                    <span className="font-[family-name:var(--font-display)] text-xl font-extrabold tabular-nums">
                      {low}-{plan.maxTotalCredits}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mt-6 pt-6 border-t-2 border-[#1B1F3B]/15">
            <Rate
              label="Talking time"
              value={`${CREDITS_PER_MINUTE} credits`}
              unit="per minute · billed afterwards"
            />
            <Rate
              label="Coding round"
              value={`${CODING_MODULE_CREDITS} credits`}
              unit="flat · upfront · up to 3 problems"
            />
            <Rate
              label="System design"
              value={`${SYSTEM_DESIGN_MODULE_CREDITS} credits`}
              unit="flat · upfront · up to 3 scenarios"
            />
          </div>
        </Card>

        {/* Free tier */}
        <Card className="p-6 md:p-8 mb-10" accent="mint">
          <div className="flex flex-wrap items-center gap-4 justify-between">
            <div>
              <Eyebrow>Free to try</Eyebrow>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold mt-1">
                100 credits when you sign up.
              </h2>
              <p className="text-sm text-[#1B1F3B]/75 mt-1">
                That is a full easy interview and its report. No card.
              </p>
            </div>
            <Link
              href={signedIn ? '/dashboard' : '/auth'}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#1B1F3B] text-white rounded-2xl border-4 border-[#1B1F3B] font-[family-name:var(--font-display)] font-bold text-sm shadow-[4px_4px_0_#FF6B35] hover:-translate-y-0.5 transition-all"
            >
              {signedIn ? 'Go to dashboard' : 'Start free'}
            </Link>
          </div>
        </Card>

        {/* FAQ */}
        <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-extrabold mb-5">
          Questions about credits
        </h2>
        <div className="space-y-3 mb-10">
          {FAQ.map((item) => (
            <Card key={item.q} className="p-5">
              <h3 className="font-[family-name:var(--font-display)] font-bold text-[#1B1F3B] flex gap-2">
                <Check className="w-5 h-5 text-[#6EE7B7] shrink-0 mt-0.5" />
                {item.q}
              </h3>
              <p className="text-sm text-[#1B1F3B]/75 mt-2 pl-7">{item.a}</p>
            </Card>
          ))}
        </div>

        {/* B2B */}
        <Card className="p-6 text-center">
          <p className="font-[family-name:var(--font-display)] font-bold">
            Running placements for a college or a team?
          </p>
          <p className="text-sm text-[#1B1F3B]/70 mt-1">
            We do bulk credits and shared dashboards.{' '}
            <a
              href="mailto:hello@devtrackacademy.com?subject=Bulk%20credits%20enquiry"
              className="text-[#FF6B35] font-bold hover:underline"
            >
              Talk to us →
            </a>
          </p>
        </Card>

        <p className="mt-8 text-center font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/50">
          All prices in INR and include applicable taxes.{' '}
          {paymentsEnabled
            ? 'Payments are processed by Razorpay.'
            : 'Buying credits is not live yet — your 100 signup credits work today.'}
        </p>
      </section>

      <Footer />
    </main>
  );
}

function Rate({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="text-center sm:text-left">
      <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-widest text-[#1B1F3B]/55">
        {label}
      </p>
      <p className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B] mt-0.5">
        {value}
      </p>
      <p className="font-[family-name:var(--font-mono)] text-[11px] text-[#1B1F3B]/55">{unit}</p>
    </div>
  );
}
