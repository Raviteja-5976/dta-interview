'use client';

import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      q: 'Do I need to talk out loud?',
      a: 'Yes. DevTrackAcademy Interview is a voice-first platform. You will answer questions out loud using your microphone, exactly like a real hiring manager call.',
    },
    {
      q: 'How long does an interview take?',
      a: 'A standard interview session takes about 15 minutes. It includes 4 distinct section blocks covering your background, system design, role-specific depth, and optional live coding.',
    },
    {
      q: 'What if I don\'t know an answer?',
      a: 'State what you know and how you would figure out the missing pieces. The AI interviewer will guide or follow up based on your partial explanation, evaluating how you handle technical uncertainty.',
    },
    {
      q: 'Can I do a coding round?',
      a: 'Yes! You can toggle the interactive coding module on or off during initial setup. When active, an inline code editor opens and test cases run while you talk through your implementation.',
    },
    {
      q: 'Is my recording shared with anyone?',
      a: 'No. Your audio recordings and transcripts are 100% private to you and are never shared with employers or recruiters. You can purge your session data at any time.',
    },
    {
      q: 'How accurate is the scoring?',
      a: 'Scores are generated from objective technical rubrics derived from your job description rather than subjective AI sentiment. Every score point cites exact transcript evidence.',
    },
    {
      q: 'Can I retry the same role?',
      a: 'Yes! You can re-run an interview for the same job posting to measure if your revised answers and lower filler word count improved your overall score band.',
    },
    {
      q: 'Which languages / accents are supported?',
      a: 'We support global English varieties with accent-neutral speech models. Speech pace and WPM bands are calibrated so non-native English speakers are scored fairly on technical content.',
    },
    {
      q: 'What if the transcript mishears me?',
      a: 'You can review and edit your transcript before final report generation if a technical term (like "Kubernetes" or "Kafka") was misheard by the audio model.',
    },
    {
      q: 'Is this for practice or for real hiring?',
      a: 'This product is built 100% for candidate practice today. We help you prepare for real interviews before it counts.',
    },
  ];

  return (
    <section id="faq" className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          FREQUENTLY ASKED QUESTIONS
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          Everything you need to know.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          Clear, honest answers about voice interviews, privacy, and scoring.
        </p>
      </div>

      {/* Accordion Container */}
      <div className="max-w-4xl mx-auto space-y-4">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={idx}
              className={`border-4 border-[#1B1F3B] rounded-2xl overflow-hidden transition-all ${
                isOpen ? 'bg-white shadow-[6px_6px_0_#1B1F3B]' : 'bg-[#F5EBE0] hover:bg-white'
              }`}
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${idx}`}
                className="w-full p-5 md:p-6 text-left flex items-center justify-between gap-4 font-[family-name:var(--font-display)] font-extrabold text-lg md:text-xl text-[#1B1F3B] focus:outline-none"
              >
                <span>{faq.q}</span>
                <div
                  className={`w-8 h-8 rounded-full border-2 border-[#1B1F3B] flex items-center justify-center shrink-0 transition-transform duration-300 ${
                    isOpen ? 'rotate-180 bg-[#FF6B35] text-white' : 'bg-white text-[#1B1F3B]'
                  }`}
                >
                  <ChevronDown className="w-5 h-5" />
                </div>
              </button>

              {isOpen && (
                <div
                  id={`faq-answer-${idx}`}
                  className="px-5 pb-6 md:px-6 md:pb-6 font-[family-name:var(--font-body)] text-sm md:text-base text-[#1B1F3B]/80 leading-relaxed border-t border-[#1B1F3B]/10 pt-4"
                >
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
