'use client';

import { ShieldCheck, Scale, MicOff, Search } from 'lucide-react';

export default function HowScoringWorks() {
  return (
    <section className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      <div className="bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-3xl p-8 md:p-12 shadow-[10px_10px_0_#1B1F3B]">
        {/* Header */}
        <div className="max-w-2xl mb-12">
          <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-white px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
            TRANSPARENT METHODOLOGY
          </span>
          <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl font-black text-[#1B1F3B]">
            How scoring works (and why you can trust it).
          </h2>
        </div>

        {/* 4 Pillars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Pillar 1 */}
          <div className="space-y-3 bg-white p-6 rounded-2xl border-2 border-[#1B1F3B]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#FF6B35] text-white rounded-xl flex items-center justify-center font-bold border-2 border-[#1B1F3B]">
                <Scale className="w-5 h-5" />
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B]">
                Scores come from a rubric, not a vibe.
              </h3>
            </div>
            <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
              The required concepts for a strong answer are established before you start. Your transcript is checked against explicit engineering criteria rather than opaque LLM ratings.
            </p>
          </div>

          {/* Pillar 2 */}
          <div className="space-y-3 bg-white p-6 rounded-2xl border-2 border-[#1B1F3B]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#FFC93C] text-[#1B1F3B] rounded-xl flex items-center justify-center font-bold border-2 border-[#1B1F3B]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B]">
                Experience questions are evaluated for depth.
              </h3>
            </div>
            <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
              Questions about your own projects and past work are scored on technical specificity, trade-off clarity, and implementation detail — never arbitrarily marked wrong.
            </p>
          </div>

          {/* Pillar 3 */}
          <div className="space-y-3 bg-white p-6 rounded-2xl border-2 border-[#1B1F3B]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#6EE7B7] text-[#1B1F3B] rounded-xl flex items-center justify-center font-bold border-2 border-[#1B1F3B]">
                <MicOff className="w-5 h-5" />
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B]">
                We don't score your accent.
              </h3>
            </div>
            <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
              Pronunciation is never scored. Speech cadence and WPM ranges are calibrated across global English varieties, and articulation feedback is strictly decoupled from technical grade.
            </p>
          </div>

          {/* Pillar 4 */}
          <div className="space-y-3 bg-white p-6 rounded-2xl border-2 border-[#1B1F3B]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#FF5C7A] text-white rounded-xl flex items-center justify-center font-bold border-2 border-[#1B1F3B]">
                <Search className="w-5 h-5" />
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-lg font-extrabold text-[#1B1F3B]">
                Every score links directly to evidence.
              </h3>
            </div>
            <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
              Click any grade point in your diagnostic report to jump straight to the exact sentence timestamp in your audio transcript that justified that score.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
