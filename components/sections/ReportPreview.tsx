'use client';

import { useState } from 'react';
import { FileText, CheckCircle2, AlertTriangle, XCircle, ArrowRight, Sparkles, RefreshCw } from 'lucide-react';

export default function ReportPreview() {
  const [activeTab, setActiveTab] = useState<'better' | 'ideal'>('better');

  return (
    <section id="report-preview" className="py-16 md:py-24 px-4 md:px-8 max-w-[1320px] mx-auto">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-widest text-[#FF6B35] uppercase bg-[#F5EBE0] px-3.5 py-1.5 border-2 border-[#1B1F3B] rounded-full inline-block mb-3">
          HIGHEST VALUE FEEDBACK
        </span>
        <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl font-black text-[#1B1F3B] tracking-tight mb-4">
          The diagnostic report.
        </h2>
        <p className="font-[family-name:var(--font-body)] text-base md:text-lg text-[#1B1F3B]/80">
          This is what you get after every session: evidence-backed breakdown, missed concepts, and exact rewrites.
        </p>
      </div>

      {/* Main Report Preview Artefact Card */}
      <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl shadow-[14px_14px_0_#1B1F3B] p-6 md:p-10 max-w-5xl mx-auto">
        {/* Report Header Row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-4 border-[#1B1F3B] pb-6 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 bg-[#FF6B35] text-white font-[family-name:var(--font-mono)] text-xs font-bold rounded uppercase">
                DIAGNOSTIC REPORT
              </span>
              <span className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60">
                August 2026
              </span>
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-black text-[#1B1F3B]">
              Senior Backend Engineer @ Stripe
            </h3>
          </div>

          <div className="flex items-center gap-4">
            <div className="bg-[#FFC93C] border-2 border-[#1B1F3B] px-4 py-2 rounded-xl text-center shadow-[3px_3px_0_#1B1F3B]">
              <div className="text-[10px] font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B]/80">
                OVERALL BAND
              </div>
              <div className="font-[family-name:var(--font-display)] text-xl font-black text-[#1B1F3B]">
                DEVELOPING
              </div>
            </div>

            <div className="bg-[#F5EBE0] border-2 border-[#1B1F3B] px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B]/80">
                DURATION
              </div>
              <div className="font-[family-name:var(--font-mono)] text-lg font-bold text-[#1B1F3B]">
                15m 24s
              </div>
            </div>
          </div>
        </div>

        {/* Section Scores Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10 bg-[#F5EBE0] p-4 rounded-2xl border-2 border-[#1B1F3B]">
          <div>
            <div className="flex justify-between text-xs font-[family-name:var(--font-mono)] font-bold mb-1">
              <span>01. Technical Intro</span>
              <span className="text-[#6EE7B7]">92%</span>
            </div>
            <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-[#1B1F3B]">
              <div className="h-full bg-[#6EE7B7] w-[92%]" />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-[family-name:var(--font-mono)] font-bold mb-1">
              <span>02. Architecture</span>
              <span className="text-[#FFC93C]">68%</span>
            </div>
            <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-[#1B1F3B]">
              <div className="h-full bg-[#FFC93C] w-[68%]" />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-[family-name:var(--font-mono)] font-bold mb-1">
              <span>03. DB Scalability</span>
              <span className="text-[#6EE7B7]">84%</span>
            </div>
            <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-[#1B1F3B]">
              <div className="h-full bg-[#6EE7B7] w-[84%]" />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-[family-name:var(--font-mono)] font-bold mb-1">
              <span>04. Live Coding</span>
              <span className="text-[#FF6B35]">75%</span>
            </div>
            <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-[#1B1F3B]">
              <div className="h-full bg-[#FF6B35] w-[75%]" />
            </div>
          </div>
        </div>

        {/* Centerpiece: Expanded Question Diagnostic Card */}
        <div className="border-4 border-[#1B1F3B] rounded-2xl p-6 bg-[#FFFFFF] shadow-[6px_6px_0_#1B1F3B] mb-8 space-y-6">
          {/* Question Title */}
          <div>
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF6B35] uppercase tracking-wider block mb-1">
              QUESTION 03 · SYSTEM DESIGN & DATABASE MIGRATION
            </span>
            <h4 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#1B1F3B]">
              "How do you execute zero-downtime database schema migrations for tables with over 100M active records?"
            </h4>
          </div>

          {/* Answer Transcript with Fillers */}
          <div className="bg-[#F5EBE0] p-4 rounded-xl border border-[#1B1F3B] font-[family-name:var(--font-body)] text-sm leading-relaxed">
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/60 block mb-1">
              YOUR VERBATIM ANSWER:
            </span>
            "We <span className="bg-[#FFC93C] px-1 rounded font-mono text-xs font-bold">um</span> usually run ALTER TABLE statements during low traffic hours like 2 AM. <span className="bg-[#FFC93C] px-1 rounded font-mono text-xs font-bold">you know</span> We just add columns with default values and hope lock contention stays low..."
          </div>

          {/* Concept Coverage Checklist */}
          <div>
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#1B1F3B]/80 uppercase block mb-2">
              CONCEPT COVERAGE EVALUATION:
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 font-[family-name:var(--font-mono)] text-xs">
              <div className="flex items-center gap-2 p-2 bg-[#6EE7B7]/20 border border-[#6EE7B7] rounded-lg text-[#1B1F3B]">
                <CheckCircle2 className="w-4 h-4 text-[#6EE7B7] shrink-0" />
                <span>Multi-step Expand/Contract pattern</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-[#FFC93C]/20 border border-[#FFC93C] rounded-lg text-[#1B1F3B]">
                <AlertTriangle className="w-4 h-4 text-[#FF6B35] shrink-0" />
                <span>Dual-writing app phase (Partial ~)</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-[#FF5C7A]/20 border border-[#FF5C7A] rounded-lg text-[#1B1F3B]">
                <XCircle className="w-4 h-4 text-[#FF5C7A] shrink-0" />
                <span>Postgres ACCESS EXCLUSIVE locks (Missed ✕)</span>
              </div>
            </div>
          </div>

          {/* Technical Correction Box */}
          <div className="bg-[#FF5C7A]/15 border-2 border-[#FF5C7A] p-4 rounded-xl font-[family-name:var(--font-body)] text-sm">
            <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[#FF5C7A] uppercase flex items-center gap-1.5 mb-1">
              ⚠️ FACTUAL CORRECTION
            </span>
            <p className="text-[#1B1F3B]">
              Running a raw <code className="font-mono font-bold">ALTER TABLE ADD COLUMN</code> acquires an ACCESS EXCLUSIVE lock on Postgres tables, blocking all read/write queries until finished. For 100M rows, this causes noticeable outage.
            </p>
          </div>

          {/* Interactive Answer Rewrite Tabs */}
          <div className="border-2 border-[#1B1F3B] rounded-2xl overflow-hidden">
            {/* Tab selector */}
            <div className="flex border-b-2 border-[#1B1F3B] bg-[#F5EBE0]">
              <button
                onClick={() => setActiveTab('better')}
                className={`flex-1 py-3 px-4 font-[family-name:var(--font-mono)] text-xs font-bold transition-colors ${
                  activeTab === 'better'
                    ? 'bg-[#FF6B35] text-white'
                    : 'text-[#1B1F3B] hover:bg-white/50'
                }`}
              >
                ✨ BETTER VERSION OF WHAT YOU SAID (RECOMMENDED)
              </button>
              <button
                onClick={() => setActiveTab('ideal')}
                className={`flex-1 py-3 px-4 font-[family-name:var(--font-mono)] text-xs font-bold transition-colors ${
                  activeTab === 'ideal'
                    ? 'bg-[#1B1F3B] text-white'
                    : 'text-[#1B1F3B] hover:bg-white/50'
                }`}
              >
                🏆 TEXTBOOK IDEAL RESPONSE
              </button>
            </div>

            {/* Tab content */}
            <div className="p-4 bg-white font-[family-name:var(--font-body)] text-sm md:text-base leading-relaxed text-[#1B1F3B]">
              {activeTab === 'better' ? (
                <div className="space-y-2">
                  <span className="text-xs font-[family-name:var(--font-mono)] font-bold text-[#FF6B35] block">
                    RETAINED YOUR OWN EXPERIENCE, ENHANCED TECHNICAL ACCURACY:
                  </span>
                  <p>
                    "We execute zero-downtime migrations using the <strong>Expand/Contract pattern</strong>. First, we add the new column as nullable without locks. Then we update application code to dual-write to both old and new columns. Finally, backfill historical data asynchronously in background batches before contracting the old column."
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <span className="text-xs font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B]/70 block">
                    COMPREHENSIVE PRINCIPLE ANSWER:
                  </span>
                  <p>
                    "Zero-downtime migrations require decoupling DDL execution from DML operations. We utilize tools like gh-ost or pg_repack for triggerless shadow table replication, combined with feature flags to switch query routing once replication lag hits zero."
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actionable Improvement Plan Preview */}
        <div className="bg-[#F5EBE0] p-6 rounded-2xl border-2 border-[#1B1F3B]">
          <h5 className="font-[family-name:var(--font-display)] text-lg font-bold text-[#1B1F3B] mb-3">
            🎯 Priority Action Items for Next Session
          </h5>
          <div className="space-y-3 font-[family-name:var(--font-body)] text-sm">
            <div className="flex items-start gap-3 bg-white p-3 rounded-xl border border-[#1B1F3B]">
              <span className="font-[family-name:var(--font-mono)] font-bold text-[#FF6B35]">#01</span>
              <div>
                <strong className="block text-[#1B1F3B]">Replace vague timing claims with explicit tools</strong>
                <span className="text-[#1B1F3B]/75">Saying "during low traffic" signals junior operations. Mention PgBouncer, CDC, or gh-ost explicitly.</span>
              </div>
            </div>

            <div className="flex items-start gap-3 bg-white p-3 rounded-xl border border-[#1B1F3B]">
              <span className="font-[family-name:var(--font-mono)] font-bold text-[#FF6B35]">#02</span>
              <div>
                <strong className="block text-[#1B1F3B]">Reduce mid-sentence filler pauses</strong>
                <span className="text-[#1B1F3B]/75">Pause for 1 second instead of saying "um" or "you know" while structuring architecture trade-offs.</span>
              </div>
            </div>
          </div>
        </div>

        {/* CTA link below */}
        <div className="text-center mt-8 pt-6 border-t border-[#1B1F3B]/10">
          <a
            href="#setup"
            className="tactile-btn px-6 py-3 bg-[#FF6B35] text-white font-bold border-2 border-[#1B1F3B] rounded-xl shadow-[4px_4px_0_#1B1F3B] inline-flex items-center gap-2"
          >
            <span>See full interactive sample report</span>
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
