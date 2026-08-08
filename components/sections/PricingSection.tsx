'use client';

import Link from 'next/link';
import { ArrowRight, Zap } from 'lucide-react';

import { CREDITS_PER_MINUTE, CREDIT_PACKS } from '@/lib/credits';

/**
 * Landing-page pricing band.
 *
 * Every number here comes from lib/credits.ts — the same functions that charge
 * the account. home-page.md's pre-launch honesty rule is that every number on
 * the page must be true, and the cheapest way to guarantee that is to never type
 * one by hand.
 */
export default function PricingSection() {
  return (
    <section id="pricing" className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      <div className="text-center max-w-3xl mx-auto mb-12">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          SIMPLE CREDITS
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          Pay for the minutes you actually talk.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          {CREDITS_PER_MINUTE} credits a minute. Finish early and the rest goes back to your balance.
          Start with 100 credits free — no card.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-5 max-w-4xl mx-auto mb-8">
        {CREDIT_PACKS.map((pack) => (
          <div
            key={pack.id}
            className={`bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 flex flex-col ${
              pack.popular ? 'shadow-[10px_10px_0_#FF6B35] md:-translate-y-3' : 'shadow-[6px_6px_0_#1B1F3B]'
            }`}
          >
            {pack.popular && (
              <span className="self-start bg-[#FFC93C] text-[#1B1F3B] border-2 border-[#1B1F3B] px-3 py-0.5 rounded-full font-[family-name:var(--font-mono)] text-[10px] font-extrabold mb-3">
                MOST POPULAR
              </span>
            )}

            <h3 className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B]">
              {pack.name}
            </h3>
            <p className="text-xs text-[#1B1F3B]/65 mt-0.5">{pack.tagline}</p>

            <div className="font-[family-name:var(--font-display)] text-4xl font-black text-[#1B1F3B] tabular-nums mt-4">
              ₹{pack.priceInr}
            </div>

            <div className="flex items-center gap-1.5 mt-1 font-[family-name:var(--font-mono)] text-sm font-bold text-[#FF6B35]">
              <Zap className="w-4 h-4 fill-current" />
              <span className="tabular-nums">{pack.credits} credits</span>
            </div>

            <p className="font-[family-name:var(--font-mono)] text-[11px] text-[#1B1F3B]/55 mt-1 tabular-nums">
              ≈ {Math.floor(pack.credits / CREDITS_PER_MINUTE)} minutes
            </p>
          </div>
        ))}
      </div>

      <div className="text-center space-y-3">
        <Link
          href="/pricing"
          className="tactile-btn inline-flex px-8 py-4 bg-[#FF6B35] text-white text-base font-bold border-4 border-[#1B1F3B] rounded-2xl shadow-[6px_6px_0_#1B1F3B] hover:bg-[#e85a27] group"
        >
          <span>See what an interview costs</span>
          <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
        </Link>

        <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/70">
          Credits never expire · Coding round +20 · System design +30
        </p>
      </div>
    </section>
  );
}
