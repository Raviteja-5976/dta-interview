'use client';

import { Check, AlertTriangle, X, Award, Activity } from 'lucide-react';

export default function WhatGetsMeasured() {
  return (
    <section id="what-gets-measured" className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          TWO EVALUATION AXES
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          What gets measured.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          We separate technical knowledge from articulation mechanics.
        </p>
      </div>

      {/* Two Large Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 mb-12">
        {/* Card A: ACCURACY */}
        <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[12px_12px_0_#FF6B35] tilt-neg-1 hover:rotate-0 transition-transform duration-300">
          <div className="flex items-center justify-between mb-6">
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold px-3 py-1 bg-[#FF6B35] text-white rounded-full uppercase border border-[#1B1F3B]">
              AXIS 01 · KNOWLEDGE
            </span>
            <Award className="w-8 h-8 text-[#FF6B35]" />
          </div>

          <h3 className="font-[family-name:var(--font-display)] text-3xl font-black text-[#1B1F3B] mb-2">
            ACCURACY
          </h3>
          <p className="font-[family-name:var(--font-body)] text-base font-semibold text-[#1B1F3B]/80 mb-6">
            Did you actually answer the question?
          </p>

          <ul className="space-y-3 font-[family-name:var(--font-body)] text-sm text-[#1B1F3B] mb-8">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>Concepts a strong answer is required to cover</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>What you covered, partially covered, and missed</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>Factually inaccurate statements with exact corrections</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#6EE7B7] text-[#1B1F3B] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>Concrete evidence citations directly from your transcript</span>
            </li>
          </ul>

          {/* Mini Concept Row Mockup */}
          <div className="bg-[#F5EBE0] border-2 border-[#1B1F3B] p-4 rounded-2xl space-y-2 font-[family-name:var(--font-mono)] text-xs">
            <div className="text-[10px] text-[#1B1F3B]/60 font-bold uppercase mb-1">
              CONCEPT BREAKDOWN SAMPLE
            </div>
            <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-[#1B1F3B]">
              <span>Bridge networking</span>
              <span className="px-2 py-0.5 bg-[#6EE7B7] text-[#1B1F3B] font-bold rounded">COVERED ✓</span>
            </div>
            <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-[#1B1F3B]">
              <span>DNS service discovery</span>
              <span className="px-2 py-0.5 bg-[#FFC93C] text-[#1B1F3B] font-bold rounded">PARTIAL ~</span>
            </div>
            <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-[#1B1F3B]">
              <span>Port publishing vs binding</span>
              <span className="px-2 py-0.5 bg-[#FF5C7A] text-white font-bold rounded">MISSED ✕</span>
            </div>
          </div>
        </div>

        {/* Card B: DELIVERY */}
        <div className="bg-[#FFC93C] border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[12px_12px_0_#1B1F3B] tilt-pos-1 hover:rotate-0 transition-transform duration-300">
          <div className="flex items-center justify-between mb-6">
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold px-3 py-1 bg-[#1B1F3B] text-[#FFC93C] rounded-full uppercase">
              AXIS 02 · ARTICULATION
            </span>
            <Activity className="w-8 h-8 text-[#1B1F3B]" />
          </div>

          <h3 className="font-[family-name:var(--font-display)] text-3xl font-black text-[#1B1F3B] mb-2">
            DELIVERY
          </h3>
          <p className="font-[family-name:var(--font-body)] text-base font-semibold text-[#1B1F3B]/80 mb-6">
            How did it come across?
          </p>

          <ul className="space-y-3 font-[family-name:var(--font-body)] text-sm text-[#1B1F3B] mb-8">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#1B1F3B] text-[#FFC93C] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>Speaking cadence and words per minute (WPM) calibration</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#1B1F3B] text-[#FFC93C] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>Filler-word frequency ("um", "like", "you know")</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#1B1F3B] text-[#FFC93C] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>Extended pauses, dead air, and hesitation spikes</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#1B1F3B] text-[#FFC93C] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
              <span>Repetitive language loops and circular explanations</span>
            </li>
          </ul>

          {/* Mini Delivery Metrics Mockup */}
          <div className="bg-[#1B1F3B] text-[#FFF8F0] border-2 border-[#1B1F3B] p-4 rounded-2xl space-y-2 font-[family-name:var(--font-mono)] text-xs">
            <div className="text-[10px] text-[#F5EBE0]/60 font-bold uppercase mb-1">
              DELIVERY TELEMETRY SAMPLE
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-[#24294A] p-2 rounded-lg border border-white/20">
                <div className="text-base font-bold text-[#6EE7B7]">142 WPM</div>
                <div className="text-[10px] text-white/70">PACING: GOOD</div>
              </div>
              <div className="bg-[#24294A] p-2 rounded-lg border border-white/20">
                <div className="text-base font-bold text-[#FF6B35]">6.3%</div>
                <div className="text-[10px] text-white/70">FILLERS: HIGH</div>
              </div>
              <div className="bg-[#24294A] p-2 rounded-lg border border-white/20">
                <div className="text-base font-bold text-[#FFC93C]">2</div>
                <div className="text-[10px] text-white/70">LONG PAUSES</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Third Coaching Principle Strip */}
      <div className="bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-2xl p-4 text-center max-w-3xl mx-auto shadow-[4px_4px_0_#1B1F3B]">
        <p className="font-[family-name:var(--font-mono)] text-xs md:text-sm font-bold text-[#1B1F3B]">
          💡 <span className="underline">Delivery is coaching, not a verdict.</span> Pace and fillers are practice signals reported separately from technical mastery.
        </p>
      </div>
    </section>
  );
}
