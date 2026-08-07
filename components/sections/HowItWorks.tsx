'use client';

import { useState } from 'react';
import { Upload, Cpu, Mic, FileSearch, FileText, CheckCircle2 } from 'lucide-react';

export default function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      num: '01',
      title: 'Upload',
      short: 'Resume, job description, company site.',
      detail: 'Provide your credentials and target job details. Our parser immediately indexes key technical terms, project claims, and required skills.',
      icon: Upload,
      accent: '#FF6B35',
    },
    {
      num: '02',
      title: 'We plan the interview',
      short: 'Compare claims against role needs and build a targeted section plan.',
      detail: 'AI cross-references your experience level with job expectations to structure a 15-minute 4-part interview strategy around your exact gaps.',
      icon: Cpu,
      accent: '#4EA8FF',
    },
    {
      num: '03',
      title: 'You talk',
      short: 'Voice interviewer probes depth, asks follow-ups, and callbacks.',
      detail: 'An adaptive voice model conducts the session. If your answer lacks specifics or omits core trade-offs, it interrupts with clarifying questions.',
      icon: Mic,
      accent: '#FFC93C',
    },
    {
      num: '04',
      title: 'We break it down',
      short: 'Transcript split question by question with timing & pace metrics.',
      detail: 'Every sentence is analyzed for technical accuracy, filler percentage, articulation pace (WPM), and key architecture concept coverage.',
      icon: FileSearch,
      accent: '#6EE7B7',
    },
    {
      num: '05',
      title: 'You get the report',
      short: 'Scores, missed concepts, and improved answer rewrites.',
      detail: 'Receive a diagnostic scorecard highlighting exact concept gaps, concrete recommendations, and an ideal response rewrite for every question.',
      icon: FileText,
      accent: '#FF5C7A',
    },
  ];

  return (
    <section id="how-it-works" className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Heading */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          ORDERED PROCESS
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          How it works. Step by step.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          From setup to diagnostic feedback in 15 minutes.
        </p>
      </div>

      {/* Interactive Timeline Bar */}
      <div className="relative mb-12 hidden lg:block">
        {/* Connecting Line */}
        <div className="absolute top-8 left-[5%] right-[5%] h-1.5 bg-[#1B1F3B] z-0" />
        <div
          className="absolute top-8 left-[5%] h-1.5 bg-[#FF6B35] z-0 transition-all duration-300"
          style={{ width: `${(activeStep / (steps.length - 1)) * 90}%` }}
        />

        {/* Step Nodes */}
        <div className="relative z-10 flex justify-between items-center px-4">
          {steps.map((step, idx) => {
            const IconComponent = step.icon;
            const isActive = activeStep === idx;
            const isPast = activeStep > idx;

            return (
              <button
                key={step.num}
                onClick={() => setActiveStep(idx)}
                className={`flex flex-col items-center group cursor-pointer focus:outline-none`}
              >
                <div
                  className={`w-16 h-16 rounded-full border-4 border-[#1B1F3B] flex items-center justify-center font-[family-name:var(--font-mono)] font-black text-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-[#FF6B35] text-white scale-125 shadow-[4px_4px_0_#1B1F3B]'
                      : isPast
                      ? 'bg-[#6EE7B7] text-[#1B1F3B]'
                      : 'bg-white text-[#1B1F3B] hover:scale-110'
                  }`}
                >
                  <IconComponent className="w-6 h-6" />
                </div>
                <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B] mt-3">
                  STEP {step.num}
                </span>
                <span className="font-[family-name:var(--font-display)] text-sm font-bold text-[#1B1F3B] group-hover:text-[#FF6B35]">
                  {step.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Step Detail Card */}
      <div className="card-brut bg-white border-4 border-[#1B1F3B] rounded-3xl shadow-[10px_10px_0_#1B1F3B] max-w-4xl mx-auto p-6 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          <div
            className="w-16 h-16 rounded-2xl border-4 border-[#1B1F3B] flex items-center justify-center shadow-[4px_4px_0_#1B1F3B] shrink-0 text-white"
            style={{ backgroundColor: steps[activeStep].accent }}
          >
            {(() => {
              const Icon = steps[activeStep].icon;
              return <Icon className="w-8 h-8" />;
            })()}
          </div>

          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-3">
              <span className="font-[family-name:var(--font-mono)] text-xs font-bold px-2.5 py-0.5 bg-[#1B1F3B] text-white rounded-lg">
                STEP {steps[activeStep].num} OF 05
              </span>
              <h3 className="font-[family-name:var(--font-display)] text-2xl font-black text-[#1B1F3B]">
                {steps[activeStep].title}
              </h3>
            </div>
            <p className="font-[family-name:var(--font-body)] text-base font-semibold text-[#1B1F3B]">
              {steps[activeStep].short}
            </p>
            <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 leading-relaxed">
              {steps[activeStep].detail}
            </p>
          </div>
        </div>

        {/* Step Navigation Dots for Mobile */}
        <div className="flex items-center justify-between border-t border-[#1B1F3B]/10 pt-4 mt-6">
          <button
            disabled={activeStep === 0}
            onClick={() => setActiveStep((prev) => Math.max(0, prev - 1))}
            className="tactile-btn px-4 py-1.5 text-xs bg-[#F5EBE0] text-[#1B1F3B] border-2 border-[#1B1F3B] rounded-xl disabled:opacity-40"
          >
            ← Previous Step
          </button>

          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i)}
                className={`w-3 h-3 rounded-full border border-[#1B1F3B] transition-all ${
                  activeStep === i ? 'bg-[#FF6B35] w-6' : 'bg-[#F5EBE0]'
                }`}
              />
            ))}
          </div>

          <button
            disabled={activeStep === steps.length - 1}
            onClick={() => setActiveStep((prev) => Math.min(steps.length - 1, prev + 1))}
            className="tactile-btn px-4 py-1.5 text-xs bg-[#FF6B35] text-white border-2 border-[#1B1F3B] rounded-xl disabled:opacity-40"
          >
            Next Step →
          </button>
        </div>
      </div>
    </section>
  );
}
