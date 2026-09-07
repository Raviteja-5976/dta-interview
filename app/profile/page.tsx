'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  User as UserIcon, 
  Mail, 
  Building, 
  Zap, 
  Volume2, 
  Sliders, 
  Shield, 
  Save, 
  Check, 
  RotateCw, 
  LogOut, 
  CreditCard, 
  History,
  Sparkles,
  ArrowLeft,
  Globe,
  Radio
} from 'lucide-react';
import AppHeader from '@/components/layout/AppHeader';
import { useAuth } from '@/context/AuthContext';
import { 
  fetchUserProfile, 
  updateUserProfile, 
  fetchCreditLedger, 
  Profile, 
  CreditLedgerItem 
} from '@/lib/supabase/db';

export default function ProfilePage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Form State
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [orgId, setOrgId] = useState('');

  // Preference State
  const [language, setLanguage] = useState('en-IN');
  const [voiceId, setVoiceId] = useState('interviewer_warm_professional_en_IN');
  const [persona, setPersona] = useState('warm_professional');
  const [defaultDifficulty, setDefaultDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [defaultDuration, setDefaultDuration] = useState(15);
  const [defaultCoding, setDefaultCoding] = useState(true);
  const [defaultSkillChallenge, setDefaultSkillChallenge] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'details' | 'prefs' | 'credits'>('details');

  // Load User Data
  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      try {
        const [profData, ledgerData] = await Promise.all([
          fetchUserProfile(user?.id),
          fetchCreditLedger(user?.id),
        ]);

        setProfile(profData);
        setLedger(ledgerData);

        // Populate Form Fields
        setFullName(profData.full_name || user?.user_metadata?.full_name || '');
        setAvatarUrl(profData.avatar_url || user?.user_metadata?.avatar_url || '');
        setOrgId(profData.org_id || '');

        const prefs = profData.prefs || {};
        if (prefs.language) setLanguage(prefs.language);
        if (prefs.voice_id) setVoiceId(prefs.voice_id);
        if (prefs.persona) setPersona(prefs.persona);
        
        if (prefs.defaults) {
          if (prefs.defaults.difficulty) setDefaultDifficulty(prefs.defaults.difficulty);
          if (prefs.defaults.duration_min) setDefaultDuration(prefs.defaults.duration_min);
          if (typeof prefs.defaults.coding === 'boolean') setDefaultCoding(prefs.defaults.coding);
          if (typeof prefs.defaults.skill_challenge === 'boolean')
            setDefaultSkillChallenge(prefs.defaults.skill_challenge);
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  // Handle Profile Form Submit
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);

    try {
      const updated = await updateUserProfile(user?.id || 'usr_demo_123', {
        full_name: fullName.trim(),
        avatar_url: avatarUrl.trim() || null,
        org_id: orgId.trim() || null,
        prefs: {
          ...profile?.prefs,
          language,
          voice_id: voiceId,
          persona,
          defaults: {
            difficulty: defaultDifficulty,
            duration_min: defaultDuration,
            coding: defaultCoding,
            skill_challenge: defaultSkillChallenge,
          },
        },
      });

      setProfile(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to update profile:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const userEmail = profile?.email || user?.email || 'candidate@devtrackacademy.com';
  const userInitial = fullName ? fullName[0].toUpperCase() : 'C';

  return (
    <div className="min-h-screen bg-[#FFF8F0] text-[#1B1F3B] flex flex-col font-[family-name:var(--font-body)]">
      {/* App Header */}
      <AppHeader profile={profile} />

      <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 md:px-8 py-8 space-y-8">
        
        {/* Back Link */}
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-xs font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B]/70 hover:text-[#FF6B35] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </Link>
        </div>

        {loading ? (
          /* Profile Skeleton Loading State */
          <div className="space-y-8 animate-pulse">
            {/* Hero Card Skeleton */}
            <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="w-20 h-20 bg-gray-200 border-4 border-[#1B1F3B] rounded-2xl" />
                <div className="space-y-2">
                  <div className="h-6 bg-gray-200 rounded w-48" />
                  <div className="h-4 bg-gray-200 rounded w-36" />
                </div>
              </div>
              <div className="w-48 h-16 bg-gray-200 border-2 border-[#1B1F3B] rounded-2xl" />
            </div>

            {/* Tab Selector Skeleton */}
            <div className="flex items-center gap-2 border-b-4 border-[#1B1F3B]/10 pb-2">
              <div className="w-36 h-10 bg-gray-200 border-2 border-[#1B1F3B] rounded-xl" />
              <div className="w-44 h-10 bg-gray-200 border-2 border-[#1B1F3B] rounded-xl" />
              <div className="w-36 h-10 bg-gray-200 border-2 border-[#1B1F3B] rounded-xl" />
            </div>

            {/* Content Card Skeleton */}
            <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] space-y-6">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="h-12 bg-gray-100 border-2 border-[#1B1F3B] rounded-xl" />
                <div className="h-12 bg-gray-100 border-2 border-[#1B1F3B] rounded-xl" />
                <div className="h-12 bg-gray-100 border-2 border-[#1B1F3B] rounded-xl" />
                <div className="h-12 bg-gray-100 border-2 border-[#1B1F3B] rounded-xl" />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Hero Profile Card */}
        <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            {/* Avatar Circle */}
            <div className="relative w-20 h-20 rounded-2xl bg-[#FF6B35] border-4 border-[#1B1F3B] overflow-hidden shadow-[4px_4px_0_#1B1F3B] flex items-center justify-center text-white font-extrabold text-3xl">
              {avatarUrl ? (
                <img src={avatarUrl} alt={fullName || 'Avatar'} className="w-full h-full object-cover" />
              ) : (
                <span>{userInitial}</span>
              )}
            </div>

            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-[family-name:var(--font-display)] font-extrabold text-2xl md:text-3xl text-[#1B1F3B]">
                  {fullName || 'Candidate Profile'}
                </h1>
                <span className="px-2.5 py-0.5 text-[10px] font-[family-name:var(--font-mono)] font-extrabold bg-[#6EE7B7] text-[#1B1F3B] border border-[#1B1F3B] rounded-full uppercase">
                  VERIFIED
                </span>
              </div>
              <p className="font-[family-name:var(--font-mono)] text-xs md:text-sm text-[#1B1F3B]/60 font-medium mt-1">
                {userEmail}
              </p>
            </div>
          </div>

          {/* Right Stats & Credits */}
          <div className="flex items-center gap-4 bg-[#FFF8F0] border-2 border-[#1B1F3B] rounded-2xl p-4 shadow-[3px_3px_0_#1B1F3B] w-full md:w-auto">
            <div className="p-3 bg-[#FF6B35]/10 rounded-xl border border-[#1B1F3B] text-[#FF6B35]">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <div>
              <span className="text-[11px] font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B]/60 uppercase tracking-wider block">
                Credits Balance
              </span>
              <span className="font-[family-name:var(--font-display)] text-2xl font-extrabold text-[#1B1F3B] tabular-nums">
                {profile?.credits_balance ?? 4} Available
              </span>
            </div>
          </div>
        </div>

        {/* Settings Tab Selector */}
        <div className="flex items-center gap-2 border-b-4 border-[#1B1F3B]/10 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('details')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-[family-name:var(--font-display)] font-bold text-sm border-2 transition-all whitespace-nowrap ${
              activeTab === 'details'
                ? 'bg-[#1B1F3B] text-white border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35]'
                : 'bg-white text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0]'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Account Details</span>
          </button>

          <button
            onClick={() => setActiveTab('prefs')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-[family-name:var(--font-display)] font-bold text-sm border-2 transition-all whitespace-nowrap ${
              activeTab === 'prefs'
                ? 'bg-[#1B1F3B] text-white border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35]'
                : 'bg-white text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0]'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Interview Preferences</span>
          </button>

          <button
            onClick={() => setActiveTab('credits')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-[family-name:var(--font-display)] font-bold text-sm border-2 transition-all whitespace-nowrap ${
              activeTab === 'credits'
                ? 'bg-[#1B1F3B] text-white border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35]'
                : 'bg-white text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0]'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Credits Ledger</span>
          </button>
        </div>

        {/* MAIN FORM */}
        <form onSubmit={handleSaveProfile} className="space-y-8">
          
          {/* TAB 1: ACCOUNT DETAILS */}
          {activeTab === 'details' && (
            <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] space-y-6 animate-in fade-in duration-200">
              <div className="border-b-2 border-[#1B1F3B]/10 pb-4">
                <h2 className="font-[family-name:var(--font-display)] font-extrabold text-xl text-[#1B1F3B]">
                  Personal Information
                </h2>
                <p className="text-xs text-[#1B1F3B]/70 font-medium mt-1">
                  Manage your display name, avatar photo, and account identifiers.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Name */}
                <div>
                  <label className="block text-xs font-bold font-[family-name:var(--font-mono)] text-[#1B1F3B] uppercase tracking-wider mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full px-4 py-3 bg-[#FFF8F0] border-2 border-[#1B1F3B] rounded-xl font-bold text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35] shadow-[2px_2px_0_#1B1F3B]"
                  />
                </div>

                {/* Email Address (Readonly) */}
                <div>
                  <label className="block text-xs font-bold font-[family-name:var(--font-mono)] text-[#1B1F3B] uppercase tracking-wider mb-2">
                    Email Address <span className="text-[#1B1F3B]/50 font-normal">(Account bound)</span>
                  </label>
                  <div className="flex items-center gap-2 px-4 py-3 bg-gray-100 border-2 border-[#1B1F3B] rounded-xl font-medium text-sm text-[#1B1F3B]/80 shadow-[2px_2px_0_#1B1F3B]">
                    <Mail className="w-4 h-4 text-[#1B1F3B]/50" />
                    <span className="truncate">{userEmail}</span>
                  </div>
                </div>

                {/* Avatar URL */}
                <div>
                  <label className="block text-xs font-bold font-[family-name:var(--font-mono)] text-[#1B1F3B] uppercase tracking-wider mb-2">
                    Avatar Picture URL
                  </label>
                  <input
                    type="text"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://example.com/avatar.jpg"
                    className="w-full px-4 py-3 bg-[#FFF8F0] border-2 border-[#1B1F3B] rounded-xl font-medium text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35] shadow-[2px_2px_0_#1B1F3B]"
                  />
                </div>

                {/* Organization ID */}
                <div>
                  <label className="block text-xs font-bold font-[family-name:var(--font-mono)] text-[#1B1F3B] uppercase tracking-wider mb-2">
                    Organization ID <span className="text-[#1B1F3B]/50 font-normal">(Optional B2B/College)</span>
                  </label>
                  <input
                    type="text"
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                    placeholder="e.g. org_college_123"
                    className="w-full px-4 py-3 bg-[#FFF8F0] border-2 border-[#1B1F3B] rounded-xl font-medium text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35] shadow-[2px_2px_0_#1B1F3B]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: INTERVIEW PREFERENCES */}
          {activeTab === 'prefs' && (
            <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] space-y-8 animate-in fade-in duration-200">
              
              {/* Language Variety */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-[family-name:var(--font-display)] font-extrabold text-lg text-[#1B1F3B] flex items-center gap-2">
                    <Globe className="w-5 h-5 text-[#FF6B35]" />
                    <span>Language Variety & WPM Calibration</span>
                  </h3>
                  <p className="text-xs text-[#1B1F3B]/70 font-medium mt-0.5">
                    Used to calibrate speaking-pace feedback and filler word thresholds during live voice sessions.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { code: 'en-IN', label: 'English (India)', note: 'Calibrated for Indian speaking pace' },
                    { code: 'en-US', label: 'English (United States)', note: 'US standard pace' },
                    { code: 'en-GB', label: 'English (United Kingdom)', note: 'UK standard pace' },
                  ].map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setLanguage(item.code)}
                      className={`p-4 text-left rounded-2xl border-2 transition-all cursor-pointer ${
                        language === item.code
                          ? 'bg-[#1B1F3B] text-white border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35]'
                          : 'bg-[#FFF8F0] text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0] shadow-[2px_2px_0_#1B1F3B]'
                      }`}
                    >
                      <div className="font-bold text-sm flex items-center justify-between">
                        <span>{item.label}</span>
                        {language === item.code && <Check className="w-4 h-4 text-[#6EE7B7]" />}
                      </div>
                      <p className={`text-[11px] mt-1 ${language === item.code ? 'text-white/70' : 'text-[#1B1F3B]/60'}`}>
                        {item.note}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Interviewer Persona & TTS Voice */}
              <div className="space-y-3 pt-4 border-t-2 border-[#1B1F3B]/10">
                <div>
                  <h3 className="font-[family-name:var(--font-display)] font-extrabold text-lg text-[#1B1F3B] flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-[#4EA8FF]" />
                    <span>Interviewer Persona & Synthetic Voice</span>
                  </h3>
                  <p className="text-xs text-[#1B1F3B]/70 font-medium mt-0.5">
                    Select the tone and style of your AI voice interviewer.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    {
                      id: 'warm_professional',
                      voiceId: 'interviewer_warm_professional_en_IN',
                      title: 'Warm Professional',
                      desc: 'Encouraging tone, constructive feedback probes.',
                    },
                    {
                      id: 'direct_technical',
                      voiceId: 'interviewer_direct_tech_lead',
                      title: 'Direct Tech Lead',
                      desc: 'Rigorous technical depth, instant counter-questions.',
                    },
                    {
                      id: 'behavioral_coach',
                      voiceId: 'interviewer_behavioral_coach',
                      title: 'Behavioral Coach',
                      desc: 'STAR-method focused, probing leadership signals.',
                    },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPersona(p.id);
                        setVoiceId(p.voiceId);
                      }}
                      className={`p-4 text-left rounded-2xl border-2 transition-all cursor-pointer ${
                        persona === p.id
                          ? 'bg-[#1B1F3B] text-white border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35]'
                          : 'bg-[#FFF8F0] text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0] shadow-[2px_2px_0_#1B1F3B]'
                      }`}
                    >
                      <div className="font-bold text-sm flex items-center justify-between">
                        <span>{p.title}</span>
                        {persona === p.id && <Radio className="w-4 h-4 text-[#FF6B35] animate-pulse" />}
                      </div>
                      <p className={`text-xs mt-1.5 ${persona === p.id ? 'text-white/80' : 'text-[#1B1F3B]/70'}`}>
                        {p.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Default Session Configurations */}
              <div className="space-y-4 pt-4 border-t-2 border-[#1B1F3B]/10">
                <div>
                  <h3 className="font-[family-name:var(--font-display)] font-extrabold text-lg text-[#1B1F3B]">
                    Default Session Settings
                  </h3>
                  <p className="text-xs text-[#1B1F3B]/70 font-medium mt-0.5">
                    Pre-filled settings when launching a new interview setup.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Default Difficulty */}
                  <div>
                    <label className="block text-xs font-bold font-[family-name:var(--font-mono)] text-[#1B1F3B] uppercase tracking-wider mb-2">
                      Default Difficulty
                    </label>
                    <div className="flex items-center gap-2">
                      {(['easy', 'medium', 'hard'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDefaultDifficulty(d)}
                          className={`flex-1 py-2.5 rounded-xl font-bold text-xs capitalize border-2 transition-all ${
                            defaultDifficulty === d
                              ? 'bg-[#FF6B35] text-white border-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]'
                              : 'bg-[#FFF8F0] text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0]'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Default Duration */}
                  <div>
                    <label className="block text-xs font-bold font-[family-name:var(--font-mono)] text-[#1B1F3B] uppercase tracking-wider mb-2">
                      Default Duration
                    </label>
                    <div className="flex items-center gap-2">
                      {[15, 30, 45, 60].map((dur) => (
                        <button
                          key={dur}
                          type="button"
                          onClick={() => setDefaultDuration(dur)}
                          className={`flex-1 py-2.5 rounded-xl font-bold text-xs border-2 transition-all ${
                            defaultDuration === dur
                              ? 'bg-[#4EA8FF] text-white border-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]'
                              : 'bg-[#FFF8F0] text-[#1B1F3B] border-[#1B1F3B] hover:bg-[#F5EBE0]'
                          }`}
                        >
                          {dur} min
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Default Modules Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <label className="flex items-center justify-between p-4 bg-[#FFF8F0] border-2 border-[#1B1F3B] rounded-2xl cursor-pointer hover:bg-[#F5EBE0] transition-colors shadow-[2px_2px_0_#1B1F3B]">
                    <div>
                      <span className="font-bold text-sm text-[#1B1F3B] block">Enable Coding Round by default</span>
                      <span className="text-xs text-[#1B1F3B]/60 font-medium">Splits live view with code editor</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={defaultCoding}
                      onChange={(e) => setDefaultCoding(e.target.checked)}
                      className="w-5 h-5 accent-[#FF6B35] rounded cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-4 bg-[#FFF8F0] border-2 border-[#1B1F3B] rounded-2xl cursor-pointer hover:bg-[#F5EBE0] transition-colors shadow-[2px_2px_0_#1B1F3B]">
                    <div>
                      <span className="font-bold text-sm text-[#1B1F3B] block">Enable the skill challenge by default</span>
                      <span className="text-xs text-[#1B1F3B]/60 font-medium">A hands-on task in a technology the role needs</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={defaultSkillChallenge}
                      onChange={(e) => setDefaultSkillChallenge(e.target.checked)}
                      className="w-5 h-5 accent-[#FF6B35] rounded cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CREDITS LEDGER */}
          {activeTab === 'credits' && (
            <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-6 md:p-8 shadow-[8px_8px_0_#1B1F3B] space-y-6 animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-[#1B1F3B]/10 pb-4">
                <div>
                  <h2 className="font-[family-name:var(--font-display)] font-extrabold text-xl text-[#1B1F3B]">
                    Credits Transaction Ledger
                  </h2>
                  <p className="text-xs text-[#1B1F3B]/70 font-medium mt-1">
                    Complete audit trail of credit grants, purchases, spends, and refunds.
                  </p>
                </div>

                <div className="px-4 py-2 bg-[#FFC93C] text-[#1B1F3B] font-[family-name:var(--font-mono)] font-extrabold text-sm border-2 border-[#1B1F3B] rounded-xl shadow-[2px_2px_0_#1B1F3B]">
                  Current Balance: {profile?.credits_balance ?? 4}
                </div>
              </div>

              {/* Ledger Table */}
              <div className="overflow-x-auto border-2 border-[#1B1F3B] rounded-2xl shadow-[4px_4px_0_#1B1F3B]">
                <table className="w-full text-left text-xs font-medium">
                  <thead className="bg-[#1B1F3B] text-white font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Balance After</th>
                      <th className="py-3 px-4">Details</th>
                      <th className="py-3 px-4">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-[#1B1F3B]/10 bg-white">
                    {ledger.map((item) => (
                      <tr key={item.id} className="hover:bg-[#FFF8F0] transition-colors">
                        <td className="py-3 px-4 font-bold capitalize">
                          <span className={`inline-block px-2 py-0.5 rounded border text-[11px] ${
                            item.kind === 'purchase' || item.kind === 'grant'
                              ? 'bg-[#6EE7B7]/20 text-[#1B1F3B] border-[#6EE7B7]'
                              : item.kind === 'spend'
                              ? 'bg-[#FF6B35]/20 text-[#1B1F3B] border-[#FF6B35]'
                              : 'bg-[#FFC93C]/30 text-[#1B1F3B] border-[#FFC93C]'
                          }`}>
                            {item.kind}
                          </span>
                        </td>
                        <td className={`py-3 px-4 font-extrabold text-sm tabular-nums ${item.amount > 0 ? 'text-[#6EE7B7]' : 'text-[#FF5C7A]'}`}>
                          {item.amount > 0 ? `+${item.amount}` : item.amount}
                        </td>
                        <td className="py-3 px-4 font-bold tabular-nums text-[#1B1F3B]">
                          {item.balance_after}
                        </td>
                        <td className="py-3 px-4 text-[#1B1F3B]/80 font-mono text-[11px]">
                          {ledgerNote(item.meta)}
                        </td>
                        <td className="py-3 px-4 text-[#1B1F3B]/60 font-mono">
                          {new Date(item.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* FLOATING / STICKY SAVE BAR */}
          <div className="sticky bottom-6 z-40 bg-[#1B1F3B] text-white border-4 border-[#1B1F3B] rounded-2xl p-4 shadow-[8px_8px_0_#FF6B35] flex items-center justify-between gap-4 animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#FF6B35]" />
              <span className="font-[family-name:var(--font-display)] font-bold text-sm text-white hidden sm:inline">
                Update account details and preferences in database
              </span>
              <span className="font-[family-name:var(--font-display)] font-bold text-sm text-white sm:hidden">
                Save settings
              </span>
            </div>

            <div className="flex items-center gap-3">
              {savedSuccess && (
                <span className="text-xs font-extrabold text-[#6EE7B7] flex items-center gap-1">
                  <Check className="w-4 h-4" /> Saved to DB!
                </span>
              )}

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-sm rounded-xl border-2 border-white shadow-[2px_2px_0_#FFFFFF] hover:bg-[#FF6B35]/90 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {saving ? <RotateCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{saving ? 'Saving...' : 'Save Profile Changes'}</span>
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                className="p-2.5 bg-[#FF5C7A]/20 text-[#FF5C7A] hover:bg-[#FF5C7A]/30 rounded-xl border border-[#FF5C7A] transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
        </>
        )}

      </main>
    </div>
  );
}

/**
 * Ledger `meta` is deliberately untyped JSONB — its shape depends on the row's
 * kind. This picks the most useful human label out of whatever is there, and
 * guarantees a string so it is safe to render.
 */
function ledgerNote(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return 'Transaction logged';

  if (meta.reason === 'settlement') {
    const minutes = meta.billed_minutes;
    return typeof minutes === 'number' ? `Unused time returned · ${minutes} min billed` : 'Unused time returned';
  }

  for (const key of ['reason', 'pack', 'pack_name', 'role'] as const) {
    const value = meta[key];
    if (typeof value === 'string' && value.length > 0) return value.replace(/_/g, ' ');
  }

  return 'Transaction logged';
}
