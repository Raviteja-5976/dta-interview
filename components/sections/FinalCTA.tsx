'use client';

import Link from 'next/link';
import { ArrowRight, FileText } from 'lucide-react';

export default function FinalCTA() {
  return (
    <section className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      <div className="bg-[#FF6B35] text-white border-6 border-[#1B1F3B] rounded-3xl p-8 md:p-16 shadow-[16px_16px_0_#1B1F3B] text-center relative overflow-hidden">
        {/* Background decorative accent element */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#FFC93C] rounded-full border-4 border-[#1B1F3B] opacity-30 pointer-events-none" />

        <div className="max-w-3xl mx-auto space-y-6 relative z-10">
          <span className="font-[family-name:var(--font-mono)] text-xs md:text-sm font-extrabold tracking-widest uppercase bg-[#1B1F3B] text-[#FFC93C] px-4 py-1.5 rounded-full inline-block border border-white/30">
            PRACTICE BEFORE IT COUNTS
          </span>

          <h2 className="font-[family-name:var(--font-display)] text-4xl sm:text-6xl font-black leading-[0.95] tracking-tight">
            Find out what you'd actually say.
          </h2>

          <p className="font-[family-name:var(--font-body)] text-lg md:text-xl text-[#F5EBE0] max-w-2xl mx-auto leading-relaxed font-medium">
            One interview. Fifteen minutes. A diagnostic report that tells you where you actually stand.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              href="/auth?tab=signup"
              className="tactile-btn px-8 py-4 bg-[#1B1F3B] text-white text-base md:text-lg font-bold border-4 border-white rounded-2xl shadow-[6px_6px_0_#FFFFFF] hover:bg-[#24294A] group w-full sm:w-auto inline-flex items-center justify-center"
            >
              <span>Start a free interview</span>
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform text-[#FFC93C]" />
            </Link>

            <a
              href="#report-preview"
              className="tactile-btn px-8 py-4 bg-white text-[#1B1F3B] text-base md:text-lg font-bold border-4 border-[#1B1F3B] rounded-2xl shadow-[6px_6px_0_#1B1F3B] hover:bg-[#F5EBE0] w-full sm:w-auto"
            >
              See a sample report
            </a>
          </div>

          <p className="font-[family-name:var(--font-mono)] text-xs text-[#F5EBE0]/70 pt-2">
            ⚡ No credit card required. Takes 60 seconds to set up.
          </p>
        </div>
      </div>
    </section>
  );
}
