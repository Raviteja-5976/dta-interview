'use client';

import { Lock, Trash2, ShieldAlert, ExternalLink } from 'lucide-react';

export default function PrivacySection() {
  return (
    <section className="py-12 px-4 md:px-8 max-w-[1320px] mx-auto">
      <div className="bg-[#FFFFFF] border-4 border-[#1B1F3B] rounded-2xl p-6 md:p-8 shadow-[6px_6px_0_#1B1F3B]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="p-1 bg-[#6EE7B7] text-[#1B1F3B] rounded-lg border border-[#1B1F3B]">
                <Lock className="w-4 h-4" />
              </span>
              <span className="font-[family-name:var(--font-mono)] text-xs font-black uppercase text-[#1B1F3B]">
                PRIVACY & DATA GUARANTEE
              </span>
            </div>

            <h3 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-[#1B1F3B]">
              Your practice sessions are 100% private.
            </h3>

            <p className="font-[family-name:var(--font-body)] text-sm text-[#1B1F3B]/80 max-w-3xl leading-relaxed">
              We process audio and generate transcripts strictly to create your diagnostic reports. <strong className="text-[#1B1F3B] underline">Your interviews are NEVER shared with employers or recruiters</strong> under any circumstances. You retain total control to delete any audio recording or transcript with one click at any time.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button className="tactile-btn px-4 py-2.5 bg-[#F5EBE0] text-[#1B1F3B] text-xs font-bold border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center gap-2">
              <Trash2 className="w-4 h-4 text-[#FF5C7A]" />
              <span>One-click Data Purge</span>
            </button>

            <a
              href="#privacy-policy"
              className="tactile-btn px-4 py-2.5 bg-white text-[#1B1F3B] text-xs font-bold border-2 border-[#1B1F3B] rounded-xl flex items-center justify-center gap-1.5 hover:bg-[#F5EBE0]"
            >
              <span>Read Privacy Policy</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
