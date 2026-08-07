'use client';

import { useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Sparkles, MessageSquare, ShieldCheck } from 'lucide-react';

export default function LiveProductTheatre() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(25);
  const [showFollowupAlert, setShowFollowupAlert] = useState(true);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 300);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <section className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          LIVE DEMO THEATRE
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          This is what it sounds like.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          Listen to an actual adaptive session where the interviewer listens, detects thin answers, and asks smart follow-ups.
        </p>
      </div>

      {/* Main Framed Player */}
      <div className="bg-[#1B1F3B] text-[#FFF8F0] border-4 border-[#1B1F3B] rounded-3xl shadow-[14px_14px_0_#1B1F3B] overflow-hidden max-w-5xl mx-auto">
        {/* Top Control Bar */}
        <div className="bg-[#24294A] px-6 py-4 border-b-2 border-white/20 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="tactile-btn w-10 h-10 bg-[#FF6B35] text-white border-2 border-white rounded-full flex items-center justify-center shadow-none hover:scale-105"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>

            <div>
              <div className="font-[family-name:var(--font-display)] text-sm md:text-base font-bold">
                Backend Engineer Interview Simulation
              </div>
              <div className="font-[family-name:var(--font-mono)] text-xs text-[#F5EBE0]/60">
                Candidate: Alex R. · Difficulty: Medium
              </div>
            </div>
          </div>

          {/* Real-time telemetry readouts */}
          <div className="flex items-center gap-4 font-[family-name:var(--font-mono)] text-xs">
            <span className="px-2.5 py-1 bg-[#24294A] border border-white/20 rounded text-[#FFC93C]">
              ⏱ 00:42 / 02:15
            </span>
            <span className="px-2.5 py-1 bg-[#24294A] border border-white/20 rounded text-[#6EE7B7]">
              ⚡ 138 WPM
            </span>
            <span className="px-2.5 py-1 bg-[#24294A] border border-white/20 rounded text-[#FF6B35]">
              💬 FILLERS: 3.1%
            </span>

            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 hover:bg-white/10 rounded transition-colors text-white/80"
              aria-label="Mute toggle"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Waveform Scrubber */}
        <div className="px-6 py-4 bg-[#1B1F3B] border-b border-white/10">
          <div className="relative w-full h-12 bg-[#24294A] rounded-xl border border-white/10 flex items-center px-4 overflow-hidden cursor-pointer">
            {/* Waveform Visualization Bars */}
            <div className="w-full flex items-center justify-between gap-1 h-8 opacity-70">
              {Array.from({ length: 64 }).map((_, idx) => {
                const height = Math.round((Math.sin(idx * 0.4) * 40 + 50) * (idx % 2 === 0 ? 0.9 : 0.6));
                const isPast = (idx / 64) * 100 <= progress;
                return (
                  <div
                    key={idx}
                    className={`w-1 rounded-full transition-all ${
                      isPast ? 'bg-[#FF6B35]' : 'bg-white/30'
                    }`}
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>

            {/* Progress line */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-[#FFC93C] z-10 shadow-[0_0_8px_#FFC93C]"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>

        {/* Synced Transcript Display */}
        <div className="p-6 md:p-8 space-y-6 relative">
          {/* Question Box */}
          <div className="border-l-4 border-[#FF6B35] pl-4 py-1 space-y-1">
            <span className="font-[family-name:var(--font-mono)] text-xs text-[#FF6B35] font-bold uppercase tracking-wider">
              AI INTERVIEWER (00:15)
            </span>
            <p className="text-base md:text-lg font-medium text-white">
              "How do you handle eventual consistency when syncing data between PostgreSQL and Elasticsearch in distributed microservices?"
            </p>
          </div>

          {/* Answer Transcript with Highlighted Fillers */}
          <div className="border-l-4 border-[#6EE7B7] pl-4 py-1 space-y-2 bg-white/5 p-4 rounded-r-xl">
            <div className="flex items-center justify-between">
              <span className="font-[family-name:var(--font-mono)] text-xs text-[#6EE7B7] font-bold uppercase tracking-wider">
                CANDIDATE TRANSCRIPT (00:28)
              </span>
              <span className="font-[family-name:var(--font-mono)] text-[10px] text-white/50">
                Pace: Optimal (138 WPM)
              </span>
            </div>
            <p className="text-sm md:text-base text-[#F5EBE0] leading-relaxed">
              "We implement Debezium for Change Data Capture (CDC) directly off the Postgres WAL. <span className="bg-[#FFC93C]/30 text-[#FFC93C] px-1 rounded font-mono text-xs">um</span> The mutations are pushed to Kafka topics. Elasticsearch consumers then read those events idempotent using the document version ID..."
            </p>
          </div>

          {/* Mid-clip Adaptive Follow-up Pop-up Card */}
          {showFollowupAlert && (
            <div className="bg-[#FFC93C] text-[#1B1F3B] border-4 border-[#1B1F3B] p-4 rounded-2xl shadow-[6px_6px_0_#1B1F3B] animate-bounce my-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-[family-name:var(--font-mono)] text-xs font-black uppercase flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#1B1F3B]" /> ADAPTIVE FOLLOW-UP GENERATED
                </span>
                <span className="font-[family-name:var(--font-mono)] text-[10px] bg-[#1B1F3B] text-white px-2 py-0.5 rounded">
                  TRIGGERED AT 00:38
                </span>
              </div>
              <p className="font-bold text-sm md:text-base">
                "Earlier you mentioned Kafka consumers — what happens if the Elasticsearch cluster drops offline for 15 minutes during an ingestion spike?"
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="text-center font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/70 mt-4">
        Sample interview · Backend Engineer · medium difficulty · 100% voice interactive
      </p>
    </section>
  );
}
