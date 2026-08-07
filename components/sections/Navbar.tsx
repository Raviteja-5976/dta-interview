'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Menu, X, ArrowUpRight, ArrowLeft, LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, openAuthModal, signOut } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      const isScrolled = window.scrollY > 100;
      setScrolled(isScrolled);

      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        setScrollProgress((window.scrollY / totalHeight) * 100);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const getUserDisplayName = () => {
    if (!user) return '';
    return user.user_metadata?.full_name || user.email?.split('@')[0] || 'Candidate';
  };

  const getUserInitial = () => {
    const name = getUserDisplayName();
    return name ? name[0].toUpperCase() : 'U';
  };

  return (
    <>
      {/* 4px Scroll Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-[#1B1F3B]/10 z-[1001]">
        <div
          className="h-full bg-[#FF6B35] transition-all duration-75"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      <header
        className={`fixed top-1 left-0 right-0 z-[1000] bg-[#FFF8F0] border-b-4 border-[#1B1F3B] transition-all duration-300 ${
          scrolled ? 'h-16 shadow-[0_4px_0_#1B1F3B]' : 'h-20'
        }`}
      >
        <div className="max-w-[1320px] mx-auto px-4 md:px-8 h-full flex items-center justify-between">
          {/* Left: Wordmark & Ecosystem Backlink */}
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="relative w-8 h-8 md:w-9 md:h-9 border-2 border-[#1B1F3B] rounded-lg overflow-hidden bg-white shadow-[2px_2px_0_#1B1F3B] group-hover:-translate-y-0.5 transition-transform">
                <Image
                  src="/logo.png"
                  alt="DevTrackAcademy Logo"
                  fill
                  sizes="36px"
                  className="object-contain p-1"
                />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-[family-name:var(--font-display)] text-lg md:text-xl font-extrabold text-[#1B1F3B] tracking-tight">
                  DevTrack<span className="text-[#FF6B35]">Academy</span>
                </span>
                <span className="text-[10px] font-[family-name:var(--font-mono)] font-bold tracking-widest px-2 py-0.5 bg-[#F5EBE0] text-[#1B1F3B] border border-[#1B1F3B] rounded-full uppercase">
                  INTERVIEW
                </span>
              </div>
            </Link>

            <a
              href="https://devtrackacademy.com"
              target="_blank"
              rel="noreferrer"
              className="hidden lg:inline-flex items-center gap-1 text-xs font-[family-name:var(--font-mono)] text-[#1B1F3B]/70 hover:text-[#FF6B35] transition-colors ml-4 pl-4 border-l border-[#1B1F3B]/20"
            >
              <ArrowLeft className="w-3 h-3" /> devtrackacademy.com
            </a>
          </div>

          {/* Center Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-6 font-medium text-sm">
            <a
              href="#how-it-works"
              className="relative py-1 text-[#1B1F3B] hover:text-[#FF6B35] transition-colors group"
            >
              How it works
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#FF6B35] group-hover:w-full transition-all duration-200" />
            </a>
            <a
              href="#what-gets-measured"
              className="relative py-1 text-[#1B1F3B] hover:text-[#FF6B35] transition-colors group"
            >
              What you get
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#FF6B35] group-hover:w-full transition-all duration-200" />
            </a>
            <a
              href="#pricing"
              className="relative py-1 text-[#1B1F3B] hover:text-[#FF6B35] transition-colors group"
            >
              Pricing
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#FF6B35] group-hover:w-full transition-all duration-200" />
            </a>
            <a
              href="#faq"
              className="relative py-1 text-[#1B1F3B] hover:text-[#FF6B35] transition-colors group"
            >
              FAQ
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-[#FF6B35] group-hover:w-full transition-all duration-200" />
            </a>
          </nav>

          {/* Right CTAs */}
          <div className="flex items-center gap-3">
            {user ? (
              /* LOGGED IN USER PILL */
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F5EBE0] border-2 border-[#1B1F3B] rounded-2xl shadow-[2px_2px_0_#1B1F3B]">
                  <div className="w-7 h-7 rounded-full bg-[#FF6B35] text-white font-[family-name:var(--font-mono)] font-bold text-xs flex items-center justify-center border border-[#1B1F3B]">
                    {getUserInitial()}
                  </div>
                  <span className="font-[family-name:var(--font-body)] text-xs font-bold text-[#1B1F3B] max-w-[120px] truncate hidden sm:inline">
                    {getUserDisplayName()}
                  </span>
                </div>
                <button
                  onClick={() => signOut()}
                  title="Sign Out"
                  className="tactile-btn p-2 bg-white text-[#1B1F3B] border-2 border-[#1B1F3B] rounded-xl shadow-[2px_2px_0_#1B1F3B] hover:bg-[#FF5C7A] hover:text-white transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* LOGGED OUT BUTTONS */
              <>
                <Link
                  href="/auth?tab=login"
                  className="hidden sm:inline-flex tactile-btn px-4 py-2 text-xs md:text-sm bg-white border-2 border-[#1B1F3B] text-[#1B1F3B] shadow-[3px_3px_0_#1B1F3B] hover:bg-[#F5EBE0]"
                >
                  Log in
                </Link>
                <Link
                  href="/auth?tab=signup"
                  className="tactile-btn px-4 py-2 text-xs md:text-sm bg-[#FF6B35] text-white border-2 border-[#1B1F3B] shadow-[3px_3px_0_#1B1F3B] hover:bg-[#e85a27]"
                >
                  Start free interview
                </Link>
              </>
            )}

            {/* Mobile menu trigger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 border-2 border-[#1B1F3B] rounded-lg bg-[#F5EBE0] text-[#1B1F3B]"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 top-16 z-[999] bg-[#1B1F3B] text-[#FFF8F0] p-6 flex flex-col justify-between md:hidden animate-fadeIn">
          <div className="space-y-6 pt-4">
            <a
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="block font-[family-name:var(--font-display)] text-2xl font-bold border-b border-white/20 pb-3"
            >
              How it works
            </a>
            <a
              href="#what-gets-measured"
              onClick={() => setMobileMenuOpen(false)}
              className="block font-[family-name:var(--font-display)] text-2xl font-bold border-b border-white/20 pb-3"
            >
              What you get
            </a>
            <a
              href="#pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="block font-[family-name:var(--font-display)] text-2xl font-bold border-b border-white/20 pb-3"
            >
              Pricing
            </a>
            <a
              href="#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="block font-[family-name:var(--font-display)] text-2xl font-bold border-b border-white/20 pb-3"
            >
              FAQ
            </a>
          </div>

          <div className="space-y-4 pb-8">
            {user ? (
              <div className="space-y-3">
                <div className="p-3 bg-white/10 rounded-xl border border-white/20 font-[family-name:var(--font-mono)] text-xs text-white">
                  Logged in as: <strong className="block text-[#FFC93C]">{getUserDisplayName()}</strong>
                </div>
                <button
                  onClick={() => {
                    signOut();
                    setMobileMenuOpen(false);
                  }}
                  className="tactile-btn w-full py-3 bg-[#FF5C7A] text-white text-sm font-bold border-2 border-white rounded-xl flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Link
                  href="/auth?tab=login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="tactile-btn py-3 bg-white text-[#1B1F3B] text-sm font-bold border-2 border-white rounded-xl text-center"
                >
                  Log In
                </Link>
                <Link
                  href="/auth?tab=signup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="tactile-btn py-3 bg-[#FF6B35] text-white text-sm font-bold border-2 border-white rounded-xl text-center"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
