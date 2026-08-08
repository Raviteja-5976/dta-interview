'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  User as UserIcon, 
  LogOut, 
  Zap, 
  LayoutDashboard, 
  Settings, 
  Menu, 
  X, 
  Plus, 
  ChevronDown,
  Sparkles
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Profile } from '@/lib/supabase/db';

interface AppHeaderProps {
  profile?: Profile | null;
}

export default function AppHeader({ profile }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut, openAuthModal } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const creditsBalance = profile?.credits_balance ?? 4;
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Candidate';
  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url;
  const userInitial = displayName ? displayName[0].toUpperCase() : 'C';

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    setDropdownOpen(false);
    await signOut();
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-50 bg-[#FFF8F0] border-b-4 border-[#1B1F3B] shadow-[0_4px_0_#1B1F3B]">
      <div className="max-w-[1320px] mx-auto px-4 md:px-8 h-20 flex items-center justify-between">
        
        {/* Left: Brand Logo & Navigation */}
        <div className="flex items-center gap-6 md:gap-10">
          <Link href="/dashboard" className="flex items-center gap-3 group">
            <div className="relative w-9 h-9 border-2 border-[#1B1F3B] rounded-lg overflow-hidden bg-white shadow-[2px_2px_0_#1B1F3B] group-hover:-translate-y-0.5 transition-transform">
              <Image
                src="/logo.png"
                alt="DevTrackAcademy Logo"
                fill
                sizes="36px"
                className="object-contain p-1"
              />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-[family-name:var(--font-display)] text-xl font-extrabold text-[#1B1F3B] tracking-tight">
                DevTrack<span className="text-[#FF6B35]">Academy</span>
              </span>
              <span className="text-[10px] font-[family-name:var(--font-mono)] font-bold tracking-widest px-2 py-0.5 bg-[#FF6B35] text-white border border-[#1B1F3B] rounded-full uppercase shadow-[1px_1px_0_#1B1F3B]">
                APP
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-2 font-[family-name:var(--font-display)] font-bold text-sm">
            <Link
              href="/dashboard"
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 transition-all ${
                pathname === '/dashboard'
                  ? 'bg-[#1B1F3B] text-white border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35]'
                  : 'bg-white text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0] shadow-[2px_2px_0_#1B1F3B]'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard</span>
            </Link>

            <Link
              href="/profile"
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 transition-all ${
                pathname === '/profile'
                  ? 'bg-[#1B1F3B] text-white border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35]'
                  : 'bg-white text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0] shadow-[2px_2px_0_#1B1F3B]'
              }`}
            >
              <UserIcon className="w-4 h-4" />
              <span>Profile</span>
            </Link>
          </nav>
        </div>

        {/* Right: Actions & User Menu */}
        <div className="flex items-center gap-3 md:gap-4">
          
          {/* Credit Pill */}
          <div
            title={`${creditsBalance} interview credits available`}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border-2 border-[#1B1F3B] font-[family-name:var(--font-mono)] font-extrabold text-xs md:text-sm shadow-[2px_2px_0_#1B1F3B] transition-transform hover:-translate-y-0.5 cursor-default ${
              creditsBalance < 3
                ? 'bg-[#FFC93C] text-[#1B1F3B]'
                : 'bg-white text-[#1B1F3B]'
            }`}
          >
            <Zap className={`w-4 h-4 fill-current ${creditsBalance < 3 ? 'text-[#1B1F3B]' : 'text-[#FF6B35]'}`} />
            <span>{creditsBalance} {creditsBalance === 1 ? 'Credit' : 'Credits'}</span>
          </div>

          {/* New Project — always the wizard, never an inline modal */}
          <Link
            href="/projects/new"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-bold text-xs md:text-sm rounded-xl border-2 border-[#1B1F3B] shadow-[3px_3px_0_#1B1F3B] hover:-translate-y-0.5 active:translate-y-0.5 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </Link>

          {/* User Profile Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 p-1.5 bg-white rounded-xl border-2 border-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B] hover:-translate-y-0.5 transition-all"
            >
              <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#FF6B35] border border-[#1B1F3B] flex items-center justify-center text-white font-bold text-sm relative">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <span>{userInitial}</span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-[#1B1F3B] transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu Popup */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-3 w-64 bg-white border-4 border-[#1B1F3B] rounded-2xl shadow-[6px_6px_0_#1B1F3B] py-3 px-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-2 border-b-2 border-[#1B1F3B]/10 mb-2">
                  <p className="font-[family-name:var(--font-display)] font-bold text-[#1B1F3B] text-sm truncate">
                    {displayName}
                  </p>
                  <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 truncate">
                    {user?.email || profile?.email || 'candidate@devtrackacademy.com'}
                  </p>
                </div>

                <Link
                  href="/dashboard"
                  onClick={() => setDropdownOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                    pathname === '/dashboard'
                      ? 'bg-[#FFF8F0] text-[#FF6B35] font-bold border border-[#1B1F3B]/20'
                      : 'text-[#1B1F3B] hover:bg-[#F5EBE0]'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Dashboard</span>
                </Link>

                <Link
                  href="/profile"
                  onClick={() => setDropdownOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                    pathname === '/profile'
                      ? 'bg-[#FFF8F0] text-[#FF6B35] font-bold border border-[#1B1F3B]/20'
                      : 'text-[#1B1F3B] hover:bg-[#F5EBE0]'
                  }`}
                >
                  <UserIcon className="w-4 h-4" />
                  <span>Account & Profile</span>
                </Link>

                <div className="my-2 border-t-2 border-[#1B1F3B]/10" />

                {user ? (
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm text-[#FF5C7A] hover:bg-[#FF5C7A]/10 transition-colors text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      openAuthModal('login');
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold text-sm text-[#FF6B35] hover:bg-[#FF6B35]/10 transition-colors text-left"
                  >
                    <UserIcon className="w-4 h-4" />
                    <span>Sign In / Sign Up</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 bg-white rounded-xl border-2 border-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-[#1B1F3B]" /> : <Menu className="w-5 h-5 text-[#1B1F3B]" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#FFF8F0] border-b-4 border-[#1B1F3B] px-4 py-4 space-y-3">
          <Link
            href="/dashboard"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 font-bold ${
              pathname === '/dashboard' ? 'bg-[#1B1F3B] text-white border-[#1B1F3B]' : 'bg-white text-[#1B1F3B] border-[#1B1F3B]'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Dashboard</span>
          </Link>
          <Link
            href="/profile"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 font-bold ${
              pathname === '/profile' ? 'bg-[#1B1F3B] text-white border-[#1B1F3B]' : 'bg-white text-[#1B1F3B] border-[#1B1F3B]'
            }`}
          >
            <UserIcon className="w-5 h-5" />
            <span>Profile</span>
          </Link>

          <Link
            href="/projects/new"
            onClick={() => setMobileMenuOpen(false)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#FF6B35] text-white font-bold rounded-xl border-2 border-[#1B1F3B]"
          >
            <Plus className="w-5 h-5" />
            <span>Create New Project</span>
          </Link>
        </div>
      )}
    </header>
  );
}
