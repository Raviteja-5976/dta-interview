'use client';

import { GraduationCap, Briefcase, Rocket } from 'lucide-react';

export default function WhoItsFor() {
  return (
    <section className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          TARGET CANDIDATES
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          Built for engineers in transition.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          Whether you're facing university campus drives or aiming for senior tier promotions.
        </p>
      </div>

      {/* Three Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Card 1: Campus Placements */}
        <div className="bg-[#FF6B35] text-[#1B1F3B] border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] tilt-neg-1 hover:rotate-0 transition-transform">
          <div className="w-12 h-12 bg-white border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center mb-6 shadow-[3px_3px_0_#1B1F3B]">
            <GraduationCap className="w-6 h-6 text-[#1B1F3B]" />
          </div>
          <span className="font-[family-name:var(--font-mono)] text-xs font-black uppercase tracking-wider block mb-2 opacity-80">
            AUDIENCE 01
          </span>
          <h3 className="font-[family-name:var(--font-display)] text-2xl font-black mb-3">
            Campus Placements
          </h3>
          <p className="font-[family-name:var(--font-body)] text-sm md:text-base font-medium leading-relaxed mb-6">
            Practice for the exact company you're interviewing at next week.
          </p>

          <div className="bg-white p-3 rounded-xl border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]">
            💬 "Targeting Amazon SDE-1 next Friday? Feed the posting and practice core DSA trade-off questions."
          </div>
        </div>

        {/* Card 2: Switching Roles */}
        <div className="bg-[#FF5C7A] text-[#1B1F3B] border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] tilt-pos-1 hover:rotate-0 transition-transform">
          <div className="w-12 h-12 bg-white border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center mb-6 shadow-[3px_3px_0_#1B1F3B]">
            <Briefcase className="w-6 h-6 text-[#1B1F3B]" />
          </div>
          <span className="font-[family-name:var(--font-mono)] text-xs font-black uppercase tracking-wider block mb-2 opacity-80">
            AUDIENCE 02
          </span>
          <h3 className="font-[family-name:var(--font-display)] text-2xl font-black mb-3">
            Switching Roles
          </h3>
          <p className="font-[family-name:var(--font-body)] text-sm md:text-base font-medium leading-relaxed mb-6">
            Find out which claims on your resume don't hold up to deep technical probing yet.
          </p>

          <div className="bg-white p-3 rounded-xl border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]">
            💬 "Moving from Frontend to Fullstack? Discover if your backend system design explanations lack depth."
          </div>
        </div>

        {/* Card 3: First Job */}
        <div className="bg-[#6EE7B7] text-[#1B1F3B] border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] tilt-neg-1-5 hover:rotate-0 transition-transform">
          <div className="w-12 h-12 bg-white border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center mb-6 shadow-[3px_3px_0_#1B1F3B]">
            <Rocket className="w-6 h-6 text-[#1B1F3B]" />
          </div>
          <span className="font-[family-name:var(--font-mono)] text-xs font-black uppercase tracking-wider block mb-2 opacity-80">
            AUDIENCE 03
          </span>
          <h3 className="font-[family-name:var(--font-display)] text-2xl font-black mb-3">
            First Job & Self-Taught
          </h3>
          <p className="font-[family-name:var(--font-body)] text-sm md:text-base font-medium leading-relaxed mb-6">
            Get used to articulating your project decisions out loud before it really counts.
          </p>

          <div className="bg-white p-3 rounded-xl border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]">
            💬 "Overcome interview anxiety by talking through your side projects out loud 5 times before real calls."
          </div>
        </div>
      </div>
    </section>
  );
}
