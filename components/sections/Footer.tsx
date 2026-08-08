'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-[#1B1F3B] text-[#FFF8F0] border-t-4 border-[#1B1F3B] pt-16 pb-12 px-4 md:px-8">
      <div className="max-w-[1320px] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 pb-12 border-b border-white/10">
          {/* Brand Column */}
          <div className="md:col-span-4 space-y-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="relative w-8 h-8 border-2 border-white rounded-lg overflow-hidden bg-white">
                <Image
                  src="/logo.png"
                  alt="DevTrackAcademy Logo"
                  fill
                  sizes="32px"
                  className="object-contain p-1"
                />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-[family-name:var(--font-display)] text-xl font-extrabold text-white">
                  DevTrack<span className="text-[#FF6B35]">Academy</span>
                </span>
                <span className="text-[10px] font-[family-name:var(--font-mono)] font-bold tracking-widest px-2 py-0.5 bg-[#FF6B35] text-white border border-white/30 rounded-full uppercase">
                  INTERVIEW
                </span>
              </div>
            </Link>

            <p className="font-[family-name:var(--font-body)] text-sm text-[#F5EBE0]/70 max-w-sm leading-relaxed">
              AI-powered voice mock interviews built for your exact resume and target job posting. Practice the interview, not the answers.
            </p>

            <div className="font-[family-name:var(--font-mono)] text-xs text-[#6EE7B7]">
              ● SYSTEM OPERATIONAL · PUBLIC BETA
            </div>
          </div>

          {/* Column 2: PRODUCT */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-wider text-[#FFC93C] uppercase">
              PRODUCT
            </h4>
            <ul className="space-y-2 font-[family-name:var(--font-body)] text-sm text-[#F5EBE0]/80">
              <li>
                <a href="#how-it-works" className="hover:text-white transition-colors">
                  How it works
                </a>
              </li>
              <li>
                <a href="#what-gets-measured" className="hover:text-white transition-colors">
                  Accuracy vs Delivery
                </a>
              </li>
              <li>
                <a href="#report-preview" className="hover:text-white transition-colors">
                  Diagnostic Reports
                </a>
              </li>
              <li>
                <a href="/pricing" className="hover:text-white transition-colors">
                  Beta Access & Pricing
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-white transition-colors">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          {/* Column 3: ECOSYSTEM */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-wider text-[#FFC93C] uppercase">
              DEVTRACKACADEMY
            </h4>
            <ul className="space-y-2 font-[family-name:var(--font-body)] text-sm text-[#F5EBE0]/80">
              <li>
                <a
                  href="https://devtrackacademy.com"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#FF6B35] transition-colors inline-flex items-center gap-1"
                >
                  Main Ecosystem <ArrowUpRight className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://workshop.devtrackacademy.com"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#FF6B35] transition-colors inline-flex items-center gap-1"
                >
                  Live Workshops <ArrowUpRight className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a
                  href="https://learn.devtrackacademy.com"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#4EA8FF] transition-colors inline-flex items-center gap-1"
                >
                  Learning Platform <ArrowUpRight className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: LEGAL & DATA */}
          <div className="md:col-span-2 space-y-3">
            <h4 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-wider text-[#FFC93C] uppercase">
              LEGAL & PRIVACY
            </h4>
            <ul className="space-y-2 font-[family-name:var(--font-body)] text-sm text-[#F5EBE0]/80">
              <li>
                <a href="#privacy" className="hover:text-white transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#terms" className="hover:text-white transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#data-deletion" className="hover:text-white transition-colors">
                  Data Deletion
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 font-[family-name:var(--font-mono)] text-xs text-[#F5EBE0]/50">
          <div>
            © {new Date().getFullYear()} DevTrackAcademy. All rights reserved.
          </div>
          <div>
            Built with Neo-Brutalist precision for software engineers.
          </div>
        </div>
      </div>
    </footer>
  );
}
