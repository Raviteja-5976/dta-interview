'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Play, Mic, FileText, ArrowRight, CheckCircle, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function Hero() {
  const { user } = useAuth();
  const [transcriptIndex, setTranscriptIndex] = useState(0);

  const transcriptLines = [
    { time: '00:04', speaker: 'AI Interviewer', text: 'Tell me about how you handled database connection pooling under high load in your recent project.' },
    { time: '00:12', speaker: 'Candidate', text: 'We used PgBouncer with transaction pooling mode, keeping connection limits under 200 while handling 15k req/sec...' },
    { time: '00:24', speaker: 'AI Interviewer', text: 'Follow-up: What happened when transaction timeouts occurred during peak spikes?' },
    { time: '00:32', speaker: 'Candidate', text: 'We introduced retry logic with exponential backoff and circuit breakers at the API gateway layer...' }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setTranscriptIndex((prev) => (prev + 1) % transcriptLines.length);
    }, 3800);
    return () => clearInterval(timer);
  }, [transcriptLines.length]);

  return (
    <section className="pt-28 md:pt-36 pb-16 md:pb-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left Column: Copy & CTAs */}
        <div className="lg:col-span-7 space-y-6 md:space-y-8">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 font-[family-name:var(--font-mono)] text-xs md:text-sm font-bold tracking-wider text-[#1B1F3B] uppercase">
            <span className="w-6 h-1 bg-[#FF6B35] rounded-full" />
            <span>AI MOCK INTERVIEWS</span>
          </div>

          {/* H1 Title */}
          <h1 className="font-[family-name:var(--font-display)] text-4xl sm:text-6xl lg:text-7xl font-black text-[#1B1F3B] leading-[0.92] tracking-tight">
            Practice the{' '}
            <span className="marker text-white">interview.</span>
            <br />
            Not the answers.
          </h1>

          {/* Sub-line */}
          <p className="font-[family-name:var(--font-body)] text-base md:text-xl text-[#1B1F3B]/80 max-w-[48ch] leading-relaxed font-medium">
            Upload your resume, the job description, and the company site. Get a voice interview built for that exact role — then a report that shows what you missed and how to say it better.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
            <Link
              href={user ? "/dashboard" : "/auth?tab=signup"}
              className="tactile-btn px-6 py-4 bg-[#FF6B35] text-white text-base md:text-lg font-bold border-4 border-[#1B1F3B] rounded-2xl shadow-[6px_6px_0_#1B1F3B] hover:bg-[#e85a27] group inline-flex items-center justify-center"
            >
              <span>{user ? "Go to Dashboard" : "Start a free interview"}</span>
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Link>

            <a
              href="#report-preview"
              className="tactile-btn px-6 py-4 bg-[#FFFFFF] text-[#1B1F3B] text-base md:text-lg font-bold border-4 border-[#1B1F3B] rounded-2xl shadow-[6px_6px_0_#1B1F3B] hover:bg-[#F5EBE0]"
            >
              See a sample report
            </a>
          </div>

          {/* Micro-line */}
          <p className="text-xs md:text-sm font-[family-name:var(--font-mono)] text-[#1B1F3B]/70">
            No card required. Takes about 15 minutes.
          </p>

          {/* Trust chips */}
          <div className="flex flex-wrap items-center gap-2 md:gap-3 pt-4">
            <span className="px-3.5 py-1.5 bg-[#FFFFFF] border-2 border-[#1B1F3B] rounded-full text-[11px] md:text-xs font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]">
              🎙️ VOICE
            </span>
            <span className="px-3.5 py-1.5 bg-[#FFFFFF] border-2 border-[#1B1F3B] rounded-full text-[11px] md:text-xs font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]">
              ⚡ ADAPTIVE FOLLOW-UPS
            </span>
            <span className="px-3.5 py-1.5 bg-[#FFFFFF] border-2 border-[#1B1F3B] rounded-full text-[11px] md:text-xs font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]">
              📊 EVIDENCE-BACKED SCORING
            </span>
          </div>
        </div>

        {/* Right Column: Animated Hero Artefact */}
        <div className="lg:col-span-5 relative">
          {/* Main Artefact Window */}
          <div className="relative bg-[#1B1F3B] border-4 border-[#1B1F3B] rounded-3xl shadow-[14px_14px_0_#1B1F3B] text-[#FFF8F0] overflow-hidden">
            {/* Header bar */}
            <div className="bg-[#24294A] px-4 py-3 border-b-2 border-white/20 flex items-center justify-between font-[family-name:var(--font-mono)] text-xs text-[#F5EBE0]/80">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#FF5C7A]" />
                <span className="w-3 h-3 rounded-full bg-[#FFC93C]" />
                <span className="w-3 h-3 rounded-full bg-[#6EE7B7]" />
                <span className="ml-2 font-bold text-white">interview · backend engineer @ stripe</span>
              </div>
              <span className="px-2 py-0.5 bg-[#FF6B35] text-white font-bold rounded text-[10px]">LIVE VOICE</span>
            </div>

            {/* Audio Waveform Row */}
            <div className="p-6 border-b border-white/10 bg-[#1B1F3B]">
              <div className="flex items-center justify-between mb-3 text-xs font-[family-name:var(--font-mono)] text-[#F5EBE0]/70">
                <span className="flex items-center gap-2 text-[#6EE7B7]">
                  <Mic className="w-4 h-4 animate-pulse text-[#FF6B35]" /> Interviewer Speaking
                </span>
                <span>00:32 / 15:00</span>
              </div>
              
              {/* Dynamic waveform bars */}
              <div className="flex items-end justify-center gap-1.5 h-16 bg-[#24294A] p-3 rounded-xl border border-white/10">
                {[40, 75, 30, 90, 60, 100, 45, 80, 65, 35, 95, 50, 70, 85, 40, 60].map((h, i) => (
                  <div
                    key={i}
                    className="w-2 bg-[#FF6B35] rounded-t-sm transition-all duration-300 animate-pulse"
                    style={{
                      height: `${((h + (transcriptIndex * 15)) % 90) + 10}%`,
                      animationDelay: `${i * 80}ms`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Live Transcript Stream */}
            <div className="p-6 space-y-4 min-h-[220px]">
              <div className="font-[family-name:var(--font-mono)] text-xs text-white/50 border-b border-white/10 pb-2 flex justify-between">
                <span>TRANSCRIPT FEED</span>
                <span>REAL-TIME ANALYSIS</span>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-3 text-xs md:text-sm animate-fadeIn">
                  <span className="font-[family-name:var(--font-mono)] text-[#FFC93C] text-xs font-bold pt-0.5">
                    {transcriptLines[transcriptIndex].time}
                  </span>
                  <div>
                    <span className="font-[family-name:var(--font-mono)] font-bold text-[#FF6B35] mr-2">
                      {transcriptLines[transcriptIndex].speaker}:
                    </span>
                    <span className="text-[#FFF8F0]">
                      {transcriptLines[transcriptIndex].text}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Floating Chip 1: WPM */}
          <div className="absolute -top-4 -left-4 md:-left-6 bg-[#FFC93C] text-[#1B1F3B] border-4 border-[#1B1F3B] px-3.5 py-1.5 rounded-xl shadow-[4px_4px_0_#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-extrabold flex items-center gap-1.5 animate-bounce">
            <span>⚡ SPEAKING · 142 WPM</span>
          </div>

          {/* Floating Chip 2: Follow-up Queued */}
          <div className="absolute -bottom-5 -right-2 md:-right-6 bg-[#6EE7B7] text-[#1B1F3B] border-4 border-[#1B1F3B] px-4 py-2 rounded-xl shadow-[4px_4px_0_#1B1F3B] font-[family-name:var(--font-mono)] text-xs font-extrabold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1B1F3B]" />
            <span>FOLLOW-UP QUEUED</span>
          </div>
        </div>
      </div>
    </section>
  );
}
