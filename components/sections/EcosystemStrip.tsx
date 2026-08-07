'use client';

import { ArrowUpRight } from 'lucide-react';

export default function EcosystemStrip() {
  return (
    <section className="py-12 px-4 md:px-8 max-w-[1320px] mx-auto">
      <div className="bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/60 uppercase tracking-widest block mb-1">
              THE ECOSYSTEM
            </span>
            <h3 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-black text-[#1B1F3B]">
              Part of DevTrackAcademy.
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Card 1: Workshops */}
            <a
              href="https://workshop.devtrackacademy.com"
              target="_blank"
              rel="noreferrer"
              className="tactile-btn p-4 bg-[#FF6B35] text-white border-2 border-[#1B1F3B] rounded-2xl shadow-[4px_4px_0_#1B1F3B] text-left block group hover:bg-[#e85a27]"
            >
              <div className="flex items-center justify-between font-[family-name:var(--font-display)] font-extrabold text-base mb-1">
                <span>Workshops</span>
                <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </div>
              <p className="font-[family-name:var(--font-body)] text-xs text-white/90">
                Live cohort-based engineering bootcamps.
              </p>
            </a>

            {/* Card 2: Learning Platform */}
            <a
              href="https://learn.devtrackacademy.com"
              target="_blank"
              rel="noreferrer"
              className="tactile-btn p-4 bg-white text-[#1B1F3B] border-2 border-[#1B1F3B] rounded-2xl shadow-[4px_4px_0_#4EA8FF] text-left block group hover:bg-[#F5EBE0]"
            >
              <div className="flex items-center justify-between font-[family-name:var(--font-display)] font-extrabold text-base mb-1">
                <span className="text-[#4EA8FF]">Learning Platform</span>
                <ArrowUpRight className="w-4 h-4 text-[#4EA8FF] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </div>
              <p className="font-[family-name:var(--font-body)] text-xs text-[#1B1F3B]/80">
                Self-paced dev paths & interactive labs.
              </p>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
