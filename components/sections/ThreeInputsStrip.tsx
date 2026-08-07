'use client';

import { useState } from 'react';
import { FileUp, FileCode, Globe, Code, Check } from 'lucide-react';

export default function ThreeInputsStrip() {
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [includeCoding, setIncludeCoding] = useState(true);

  return (
    <section id="setup" className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Heading */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          INSTANT CUSTOMIZATION
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight">
          Three things in. One real interview out.
        </h2>
      </div>

      {/* Three Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mb-12">
        {/* Card 1: Resume */}
        <div className="card-brut tilt-neg-1 bg-white relative group rounded-3xl border-4 border-[#1B1F3B] shadow-[6px_6px_0_#1B1F3B]">
          <div className="w-12 h-12 bg-[#FF6B35] border-2 border-[#1B1F3B] rounded-xl shadow-[3px_3px_0_#1B1F3B] flex items-center justify-center mb-6">
            <FileUp className="w-6 h-6 text-white" />
          </div>
          <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/70 tracking-wider uppercase block mb-2">
            INPUT 01 · RESUME
          </span>
          <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#1B1F3B] mb-3">
            Upload Your PDF
          </h3>
          <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
            We pull out your skills, projects, stack experience, and the specific resume claims worth probing.
          </p>
        </div>

        {/* Card 2: Job Description */}
        <div className="card-brut tilt-pos-1 bg-white relative group rounded-3xl border-4 border-[#1B1F3B] shadow-[6px_6px_0_#1B1F3B]">
          <div className="w-12 h-12 bg-[#4EA8FF] border-2 border-[#1B1F3B] rounded-xl shadow-[3px_3px_0_#1B1F3B] flex items-center justify-center mb-6">
            <FileCode className="w-6 h-6 text-white" />
          </div>
          <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/70 tracking-wider uppercase block mb-2">
            INPUT 02 · JOB DESCRIPTION
          </span>
          <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#1B1F3B] mb-3">
            Paste Job Posting
          </h3>
          <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
            We separate required competencies from nice-to-haves and construct targeted interview questions.
          </p>
        </div>

        {/* Card 3: Company Site (Optional - Dashed Border) */}
        <div className="card-brut tilt-neg-1-5 bg-[#F5EBE0] border-4 border-dashed border-[#1B1F3B] rounded-3xl relative group shadow-none hover:shadow-[6px_6px_0_#1B1F3B]">
          <div className="absolute top-4 right-4 bg-[#FFC93C] text-[#1B1F3B] border-2 border-[#1B1F3B] px-2.5 py-0.5 rounded-full text-[10px] font-[family-name:var(--font-mono)] font-bold uppercase">
            OPTIONAL
          </div>
          <div className="w-12 h-12 bg-[#FF5C7A] border-2 border-[#1B1F3B] rounded-xl shadow-[3px_3px_0_#1B1F3B] flex items-center justify-center mb-6">
            <Globe className="w-6 h-6 text-white" />
          </div>
          <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/70 tracking-wider uppercase block mb-2">
            INPUT 03 · COMPANY SITE
          </span>
          <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#1B1F3B] mb-3">
            Company URL
          </h3>
          <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
            We read what they build so questions sound like they came directly from an insider hiring manager.
          </p>
        </div>
      </div>

      {/* Difficulty Preview Bar */}
      <div className="bg-[#FFFFFF] border-4 border-[#1B1F3B] rounded-3xl p-6 shadow-[6px_6px_0_#1B1F3B] max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Difficulty selector */}
          <div className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B] uppercase">
              DIFFICULTY:
            </span>
            <div className="flex items-center gap-2">
              {(['Easy', 'Medium', 'Hard'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setDifficulty(level)}
                  className={`px-4 py-1.5 rounded-xl border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-bold transition-all ${
                    difficulty === level
                      ? 'bg-[#FF6B35] text-white shadow-[2px_2px_0_#1B1F3B] -translate-y-0.5'
                      : 'bg-[#F5EBE0] text-[#1B1F3B] hover:bg-white'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Coding toggle */}
          <button
            onClick={() => setIncludeCoding(!includeCoding)}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-bold transition-all cursor-pointer ${
              includeCoding
                ? 'bg-[#6EE7B7] text-[#1B1F3B] shadow-[3px_3px_0_#1B1F3B]'
                : 'bg-[#F5EBE0] text-[#1B1F3B]/60'
            }`}
          >
            <Code className="w-4 h-4" />
            <span>Include a coding round</span>
            <div
              className={`w-4 h-4 rounded border border-[#1B1F3B] flex items-center justify-center ${
                includeCoding ? 'bg-[#1B1F3B] text-white' : 'bg-white'
              }`}
            >
              {includeCoding && <Check className="w-3 h-3" />}
            </div>
          </button>
        </div>

        <p className="text-center font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/70 mt-4 border-t border-[#1B1F3B]/10 pt-3">
          ⚡ Setup takes about 60 seconds.
        </p>
      </div>
    </section>
  );
}
