'use client';

import { XCircle, CheckCircle2, Clock, Sparkles } from 'lucide-react';

export default function AdaptiveInterviewer() {
  return (
    <section className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          KEY DIFFERENTIATOR
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          An adaptive interviewer. Not a script.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          Static question lists test memorization. Adaptive voice interviews test actual technical judgment.
        </p>
      </div>

      {/* Two Column Comparison Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
        {/* Left Column: Fixed Question List */}
        <div className="bg-[#F5EBE0] border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 opacity-80 filter saturate-[0.6] hover:saturate-100 transition-all">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-3 h-3 rounded-full bg-[#FF5C7A]" />
            <h3 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#1B1F3B]">
              TRADITIONAL MOCK TOOLS
            </h3>
          </div>
          <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 uppercase font-bold mb-6">
            A FIXED QUESTION LIST
          </p>

          <ul className="space-y-4 font-[family-name:var(--font-body)] text-sm md:text-base text-[#1B1F3B]/70">
            <li className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-[#FF5C7A] shrink-0 mt-0.5" />
              <span>Same static question list presented to every candidate</span>
            </li>
            <li className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-[#FF5C7A] shrink-0 mt-0.5" />
              <span>Zero follow-up questions when your answer is thin or incomplete</span>
            </li>
            <li className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-[#FF5C7A] shrink-0 mt-0.5" />
              <span>Ignores claims and details you previously mentioned</span>
            </li>
            <li className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-[#FF5C7A] shrink-0 mt-0.5" />
              <span>Generic AI summary feedback at the end without evidence</span>
            </li>
          </ul>
        </div>

        {/* Right Column: DevTrackAcademy Adaptive Interviewer */}
        <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[10px_10px_0_#FF6B35] relative">
          <div className="absolute -top-3.5 right-6 bg-[#FF6B35] text-white border-2 border-[#1B1F3B] px-3.5 py-0.5 rounded-full font-[family-name:var(--font-mono)] text-xs font-bold uppercase">
            DEVTRACKACADEMY
          </div>

          <div className="flex items-center gap-2 mb-6">
            <span className="w-3 h-3 rounded-full bg-[#6EE7B7]" />
            <h3 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#1B1F3B]">
              DEVTRACKACADEMY
            </h3>
          </div>
          <p className="font-[family-name:var(--font-mono)] text-xs text-[#FF6B35] uppercase font-bold mb-6">
            AN ADAPTIVE VOICE INTERVIEWER
          </p>

          <ul className="space-y-4 font-[family-name:var(--font-body)] text-sm md:text-base text-[#1B1F3B]">
            <li className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#6EE7B7] shrink-0 mt-0.5" />
              <span>Questions custom built from your resume against that exact job post</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#6EE7B7] shrink-0 mt-0.5" />
              <span>Follows up immediately when your answer lacks concrete depth</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#6EE7B7] shrink-0 mt-0.5" />
              <span>Comes back to specific architecture claims you mentioned earlier</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#6EE7B7] shrink-0 mt-0.5" />
              <span>Steps in constructively only if you state something technically wrong</span>
            </li>
            <li className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#6EE7B7] shrink-0 mt-0.5" />
              <span>Provides transcript timestamps and rubric evidence for every score</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Memory Callback Proof Card */}
      <div className="bg-[#FFC93C] border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] max-w-4xl mx-auto">
        <div className="flex items-center justify-between border-b-2 border-[#1B1F3B] pb-3 mb-4">
          <span className="font-[family-name:var(--font-mono)] text-xs font-black uppercase text-[#1B1F3B] flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[#1B1F3B]" /> PROOF OF ADAPTIVE MEMORY CALLBACK
          </span>
          <span className="font-[family-name:var(--font-mono)] text-xs font-bold bg-[#1B1F3B] text-[#FFC93C] px-3 py-1 rounded-full">
            ASKED AT 18:40 · YOU MENTIONED IT AT 04:12
          </span>
        </div>

        <blockquote className="font-[family-name:var(--font-display)] text-lg md:text-xl font-extrabold text-[#1B1F3B] leading-snug">
          "Earlier at 04:12 you mentioned building a RAG pipeline with Pinecone vector indexes — how did you decide on your embedding chunk size vs latency trade-offs?"
        </blockquote>
      </div>
    </section>
  );
}
