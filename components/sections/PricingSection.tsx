'use client';

import { Check, ArrowRight, Zap, Shield } from 'lucide-react';

export default function PricingSection() {
  return (
    <section id="pricing" className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          TRANSPARENT BETA ACCESS
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          Free while we're in beta.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          Get full access to custom AI voice interviews and diagnostic reports during our public release preview.
        </p>
      </div>

      {/* Single Beta Access Card */}
      <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-8 md:p-12 shadow-[12px_12px_0_#FF6B35] max-w-2xl mx-auto relative overflow-hidden">
        {/* Beta Pill Badge */}
        <div className="absolute top-6 right-6 bg-[#FFC93C] text-[#1B1F3B] border-2 border-[#1B1F3B] px-4 py-1 rounded-full font-[family-name:var(--font-mono)] text-xs font-extrabold shadow-[2px_2px_0_#1B1F3B]">
          PUBLIC BETA · 3 SESSIONS / MO
        </div>

        <div className="space-y-6">
          <div>
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/60 uppercase">
              BETA PLAN
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-[family-name:var(--font-display)] text-5xl md:text-6xl font-black text-[#1B1F3B]">
                $0
              </span>
              <span className="font-[family-name:var(--font-mono)] text-sm font-bold text-[#1B1F3B]/70">
                / month during beta
              </span>
            </div>
          </div>

          <p className="font-[family-name:var(--font-body)] text-base text-[#1B1F3B]/80">
            No credit card required. Includes 3 full voice mock interview sessions per month with full diagnostic reports.
          </p>

          <div className="border-t-2 border-b-2 border-[#1B1F3B] py-6 space-y-3 font-[family-name:var(--font-body)] text-sm font-semibold">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs">✓</div>
              <span>Custom interviews generated from your Resume & Job Post</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs">✓</div>
              <span>Adaptive voice AI with real-time follow-ups & callbacks</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs">✓</div>
              <span>Full diagnostic report with accuracy & delivery metrics</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs">✓</div>
              <span>Ideal answer rewrites and actionable improvement plans</span>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <a
              href="#setup"
              className="tactile-btn w-full py-4 bg-[#FF6B35] text-white text-base font-bold text-center border-4 border-[#1B1F3B] rounded-2xl shadow-[6px_6px_0_#1B1F3B] hover:bg-[#e85a27] group"
            >
              <span>Start a free interview</span>
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </a>

            <p className="text-center font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/70">
              ⚡ Pricing after beta will be announced before it changes. Beta users get advance notice first.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
