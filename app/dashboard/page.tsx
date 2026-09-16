'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Plus,
  Search,
  Zap,
  Briefcase,
  Award,
  Clock,
  ArrowUpRight,
  AlertCircle,
  Trash2,
  Sparkles,
  RotateCw,
  X,
  CreditCard,
} from 'lucide-react';
import AppHeader from '@/components/layout/AppHeader';
import RedeemCode from '@/components/app/RedeemCode';
import { useAuth } from '@/context/AuthContext';
import {
  fetchUserProfile,
  fetchUserProjects,
  deleteProject,
  Profile,
  Project,
} from '@/lib/supabase/db';

export default function DashboardPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'preparing' | 'draft'>('all');

  // Delete Confirmation Modal State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load Data
  const loadData = async () => {
    setLoading(true);
    try {
      const [profData, projsData] = await Promise.all([
        fetchUserProfile(user?.id),
        fetchUserProjects(user?.id),
      ]);
      setProfile(profData);
      setProjects(projsData);
    } catch (err) {
      console.error('Failed loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Project creation lives at /projects/new. It needs a resume and a job
  // description before Phase 1 preparation can run, which is more than a modal
  // on this page should be collecting.

  // Handle Delete Project
  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteProject(user?.id || '', projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setDeletingId(null);
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  // Derived Metrics for Stat Counter Strip
  const totalProjects = projects.length;
  // Same rule as the header pill: no invented fallback. Unknown reads as '—'.
  const creditsRemaining = profile?.credits_balance ?? null;
  const totalInterviews = projects.reduce((acc, p) => acc + (p.sessions_count || p.stats?.sessions_count || 0), 0);
  
  const readyProjectsWithScores = projects.filter((p) => (p.readiness_overall || p.readiness?.overall) && (p.readiness_overall || p.readiness?.overall)! > 0);
  const avgReadiness = readyProjectsWithScores.length > 0
    ? Math.round(readyProjectsWithScores.reduce((acc, p) => acc + (p.readiness_overall || p.readiness?.overall || 0), 0) / readyProjectsWithScores.length)
    : 0;

  // Filtered Projects List
  const filteredProjects = projects.filter((p) => {
    const matchesSearch = 
      p.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.role_title.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = 
      statusFilter === 'all' ? true : p.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-[#FFF8F0] text-[#1B1F3B] flex flex-col font-[family-name:var(--font-body)]">
      {/* App Header Navigation */}
      <AppHeader profile={profile} />

      <main className="flex-1 max-w-[1320px] w-full mx-auto px-4 md:px-8 py-8 space-y-8">
        
        {/* Zero Credits Warning Band */}
        {creditsRemaining === 0 && (
          <div className="bg-[#FFC93C] border-4 border-[#1B1F3B] rounded-2xl p-4 md:p-6 shadow-[6px_6px_0_#1B1F3B] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in duration-300">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl text-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]">
                <Zap className="w-6 h-6 fill-current text-[#FF6B35]" />
              </div>
              <div>
                <h3 className="font-[family-name:var(--font-display)] font-extrabold text-base md:text-lg text-[#1B1F3B]">
                  You&apos;re out of interview credits!
                </h3>
                <p className="text-xs md:text-sm font-medium text-[#1B1F3B]/80">
                  Your existing projects remain fully accessible. Purchase a credit pack to launch new mock interview sessions.
                </p>
              </div>
            </div>
            <Link
              href="/credits"
              className="px-5 py-2.5 bg-[#1B1F3B] text-white font-[family-name:var(--font-display)] font-bold text-xs md:text-sm rounded-xl border-2 border-[#1B1F3B] shadow-[3px_3px_0_#FFFFFF] hover:-translate-y-0.5 transition-all whitespace-nowrap"
            >
              Get More Credits
            </Link>
          </div>
        )}

        {/* 4 Stat Block Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {/* Stat 1: Credits */}
          <div className="bg-white border-4 border-[#1B1F3B] rounded-2xl p-5 shadow-[6px_6px_0_#1B1F3B] transition-transform hover:-translate-y-1">
            <div className="flex items-center justify-between text-[#1B1F3B]/70 mb-2">
              <span className="text-xs font-bold font-[family-name:var(--font-mono)] uppercase tracking-wider">Credits Available</span>
              <div className="p-1.5 bg-[#FF6B35]/10 rounded-lg border border-[#1B1F3B]">
                <Zap className="w-4 h-4 text-[#FF6B35]" />
              </div>
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-gray-200 rounded animate-pulse my-0.5" />
            ) : (
              <div className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B] tabular-nums">
                {creditsRemaining ?? '—'}
              </div>
            )}
            <p className="text-xs text-[#1B1F3B]/60 mt-1 font-medium">Ready to spend</p>
          </div>

          {/* Stat 2: Projects */}
          <div className="bg-white border-4 border-[#1B1F3B] rounded-2xl p-5 shadow-[6px_6px_0_#1B1F3B] transition-transform hover:-translate-y-1">
            <div className="flex items-center justify-between text-[#1B1F3B]/70 mb-2">
              <span className="text-xs font-bold font-[family-name:var(--font-mono)] uppercase tracking-wider">Role Projects</span>
              <div className="p-1.5 bg-[#4EA8FF]/10 rounded-lg border border-[#1B1F3B]">
                <Briefcase className="w-4 h-4 text-[#4EA8FF]" />
              </div>
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-gray-200 rounded animate-pulse my-0.5" />
            ) : (
              <div className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B] tabular-nums">
                {totalProjects}
              </div>
            )}
            <p className="text-xs text-[#1B1F3B]/60 mt-1 font-medium">Active workspaces</p>
          </div>

          {/* Stat 3: Interviews Completed */}
          <div className="bg-white border-4 border-[#1B1F3B] rounded-2xl p-5 shadow-[6px_6px_0_#1B1F3B] transition-transform hover:-translate-y-1">
            <div className="flex items-center justify-between text-[#1B1F3B]/70 mb-2">
              <span className="text-xs font-bold font-[family-name:var(--font-mono)] uppercase tracking-wider">Interviews Run</span>
              <div className="p-1.5 bg-[#6EE7B7]/10 rounded-lg border border-[#1B1F3B]">
                <Award className="w-4 h-4 text-[#1B1F3B]" />
              </div>
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-gray-200 rounded animate-pulse my-0.5" />
            ) : (
              <div className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B] tabular-nums">
                {totalInterviews}
              </div>
            )}
            <p className="text-xs text-[#1B1F3B]/60 mt-1 font-medium">Total sessions completed</p>
          </div>

          {/* Stat 4: Avg Score */}
          <div className="bg-white border-4 border-[#1B1F3B] rounded-2xl p-5 shadow-[6px_6px_0_#1B1F3B] transition-transform hover:-translate-y-1">
            <div className="flex items-center justify-between text-[#1B1F3B]/70 mb-2">
              <span className="text-xs font-bold font-[family-name:var(--font-mono)] uppercase tracking-wider">Avg Readiness</span>
              <div className="p-1.5 bg-[#FFC93C]/20 rounded-lg border border-[#1B1F3B]">
                <Sparkles className="w-4 h-4 text-[#1B1F3B]" />
              </div>
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-gray-200 rounded animate-pulse my-0.5" />
            ) : (
              <div className="font-[family-name:var(--font-display)] text-3xl md:text-4xl font-extrabold text-[#1B1F3B] tabular-nums">
                {avgReadiness > 0 ? `${avgReadiness}%` : '—'}
              </div>
            )}
            <p className="text-xs text-[#1B1F3B]/60 mt-1 font-medium">Across active roles</p>
          </div>
        </section>

        {/* Coupon redemption — same component as /credits and the profile
            ledger, so a code behaves identically wherever it is entered. */}
        <RedeemCode className="p-5" onRedeemed={() => void loadData()} />

        {/* Action & Filter Bar Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-4 border-[#1B1F3B]/10 pb-6">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-extrabold text-[#1B1F3B] tracking-tight">
              Interview Projects
            </h1>
            <p className="text-xs md:text-sm font-medium text-[#1B1F3B]/70 mt-1">
              Select a target role to view resume alignment, gap analysis, and tailored AI voice interviews.
            </p>
          </div>

          {/* The real creation path: the wizard collects the resume and job
              description that Phase 1 preparation cannot run without. */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Link
              href="/credits"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-[#1B1F3B] font-[family-name:var(--font-display)] font-extrabold text-sm rounded-xl border-4 border-[#1B1F3B] shadow-[4px_4px_0_#1B1F3B] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer"
            >
              <CreditCard className="w-5 h-5 stroke-[2.5]" />
              <span>Buy Credits</span>
            </Link>

            <Link
              href="/projects/new"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-sm rounded-xl border-4 border-[#1B1F3B] shadow-[4px_4px_0_#1B1F3B] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer"
            >
              <Plus className="w-5 h-5 stroke-[3]" />
              <span>New Interview Project</span>
            </Link>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B1F3B]/50" />
            <input
              type="text"
              placeholder="Search company or role title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-[#1B1F3B] rounded-xl font-medium text-sm text-[#1B1F3B] focus:outline-none focus:ring-2 focus:ring-[#FF6B35] shadow-[2px_2px_0_#1B1F3B]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#1B1F3B]/50 hover:text-[#1B1F3B]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-white border-2 border-[#1B1F3B] rounded-xl shadow-[2px_2px_0_#1B1F3B] overflow-x-auto">
            {(['all', 'ready', 'preparing', 'draft'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-[#1B1F3B] text-white shadow-[1px_1px_0_#FF6B35]'
                    : 'text-[#1B1F3B]/70 hover:bg-[#F5EBE0] hover:text-[#1B1F3B]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Project Grid */}
        {loading ? (
          /* Loading Skeletons */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white border-4 border-[#1B1F3B] rounded-2xl p-6 shadow-[6px_6px_0_#1B1F3B] animate-pulse space-y-4"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gray-200 border-2 border-[#1B1F3B] rounded-xl" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                  </div>
                </div>
                <div className="h-20 bg-gray-100 rounded-xl border border-gray-200" />
                <div className="h-10 bg-gray-200 rounded-xl" />
              </div>
            ))}
          </div>
        ) : filteredProjects.length > 0 ? (
          /* Projects Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((proj, idx) => {
              const score = proj.readiness_overall || proj.readiness?.overall || 0;
              const sessionsCount = proj.sessions_count ?? proj.stats?.sessions_count ?? 0;
              
              // Tilt variation for Neo-Brutalist character
              const tilts = ['tilt-neg-1', 'tilt-pos-1', 'tilt-neg-1-5', 'tilt-pos-1-5'];
              const tiltClass = tilts[idx % tilts.length];

              return (
                <div
                  key={proj.id}
                  className={`group relative bg-white border-4 border-[#1B1F3B] rounded-2xl p-6 shadow-[6px_6px_0_#1B1F3B] hover:shadow-[10px_10px_0_#1B1F3B] hover:-translate-y-1 transition-all duration-200 flex flex-col justify-between ${tiltClass}`}
                >
                  <div>
                    {/* Top Row: Logo & Seniority Chip */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="relative w-12 h-12 rounded-xl bg-[#FFF8F0] border-2 border-[#1B1F3B] flex items-center justify-center overflow-hidden shadow-[2px_2px_0_#1B1F3B] font-extrabold text-lg text-[#1B1F3B]">
                          {proj.company_domain ? (
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${proj.company_domain}&sz=64`}
                              alt={proj.company_name}
                              className="w-8 h-8 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span>{proj.company_name[0].toUpperCase()}</span>
                          )}
                        </div>
                        <div>
                          <h3 className="font-[family-name:var(--font-display)] font-extrabold text-base text-[#1B1F3B] line-clamp-1 group-hover:text-[#FF6B35] transition-colors">
                            {proj.company_name}
                          </h3>
                          <p className="font-[family-name:var(--font-mono)] text-xs text-[#1B1F3B]/60 line-clamp-1 font-medium">
                            {proj.company_domain || 'Company Profile'}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => setDeletingId(proj.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-[#1B1F3B]/40 hover:text-[#FF5C7A] hover:bg-[#FF5C7A]/10 rounded-lg transition-all"
                        title="Delete Project"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Role Title */}
                    <div className="mb-4">
                      <h4 className="font-[family-name:var(--font-display)] font-bold text-lg text-[#1B1F3B] leading-snug line-clamp-2">
                        {proj.role_title}
                      </h4>
                      {proj.seniority && (
                        <span className="inline-block mt-1.5 px-2.5 py-0.5 text-[11px] font-[family-name:var(--font-mono)] font-bold bg-[#F5EBE0] text-[#1B1F3B] border border-[#1B1F3B] rounded-md">
                          {proj.seniority}
                        </span>
                      )}
                    </div>

                    {/* Readiness Ring / Badge Box */}
                    <div className="bg-[#FFF8F0] border-2 border-[#1B1F3B] rounded-xl p-4 mb-4 flex items-center justify-between shadow-[2px_2px_0_#1B1F3B]">
                      <div>
                        <span className="text-[11px] font-[family-name:var(--font-mono)] font-bold text-[#1B1F3B]/60 uppercase tracking-wider block">
                          Role Readiness
                        </span>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                          <span className="font-[family-name:var(--font-display)] text-3xl font-extrabold text-[#1B1F3B] tabular-nums">
                            {score > 0 ? `${score}%` : '—'}
                          </span>
                          {score > 0 && (
                            <span className="text-xs font-bold text-[#6EE7B7] bg-[#1B1F3B] px-1.5 py-0.5 rounded">
                              {score >= 80 ? 'Strong' : score >= 60 ? 'Developing' : 'Needs Practice'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Mini Dial Gauge */}
                      <div className="w-14 h-14 relative flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                          <path
                            className="text-[#1B1F3B]/10"
                            strokeWidth="4"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className={score >= 80 ? 'text-[#6EE7B7]' : score >= 60 ? 'text-[#FFC93C]' : score > 0 ? 'text-[#FF6B35]' : 'text-gray-300'}
                            strokeDasharray={`${score || 0}, 100`}
                            strokeWidth="4"
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <Sparkles className="w-4 h-4 absolute text-[#1B1F3B]" />
                      </div>
                    </div>

                    {/* Stats & Session Summary */}
                    <div className="flex items-center justify-between text-xs font-medium text-[#1B1F3B]/70 mb-6">
                      <div className="flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-[#FF6B35]" />
                        <span>{sessionsCount} {sessionsCount === 1 ? 'Interview' : 'Interviews'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-[#4EA8FF]" />
                        <span>
                          {proj.last_session_at
                            ? 'Recently active'
                            : 'No attempts yet'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status & Open Workspace Button */}
                  <div className="space-y-2">
                    {/* Status Chip */}
                    {proj.status === 'preparing' && (
                      <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-[#FFC93C] text-[#1B1F3B] border-2 border-[#1B1F3B] rounded-lg font-bold text-xs">
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Preparing role research & JD match…</span>
                      </div>
                    )}

                    {proj.status === 'draft' && (
                      <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-[#4EA8FF]/20 text-[#1B1F3B] border-2 border-[#1B1F3B] rounded-lg font-bold text-xs">
                        <span>Draft Setup</span>
                      </div>
                    )}

                    {proj.status === 'failed' && (
                      <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-[#FF5C7A]/20 text-[#FF5C7A] border-2 border-[#FF5C7A] rounded-lg font-bold text-xs">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Prep issue — Retry</span>
                      </div>
                    )}

                    {/* Action Button */}
                    <Link
                      href={`/projects/${proj.id}`}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1B1F3B] text-white font-[family-name:var(--font-display)] font-extrabold text-sm rounded-xl border-2 border-[#1B1F3B] shadow-[3px_3px_0_#FF6B35] group-hover:bg-[#FF6B35] group-hover:shadow-[3px_3px_0_#1B1F3B] transition-all"
                    >
                      <span>Open Workspace</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty State */
          <div className="bg-white border-4 border-[#1B1F3B] rounded-3xl p-8 md:p-12 shadow-[8px_8px_0_#1B1F3B] text-center max-w-2xl mx-auto space-y-6">
            <div className="w-16 h-16 bg-[#FFF8F0] border-4 border-[#1B1F3B] rounded-2xl flex items-center justify-center mx-auto shadow-[4px_4px_0_#1B1F3B] text-[#FF6B35]">
              <Briefcase className="w-8 h-8 stroke-[2.5]" />
            </div>

            <div className="space-y-2">
              <h3 className="font-[family-name:var(--font-display)] font-extrabold text-2xl text-[#1B1F3B]">
                Start with the job you&apos;re actually interviewing for.
              </h3>
              <p className="text-sm font-medium text-[#1B1F3B]/70 max-w-md mx-auto">
                Create a role project with your resume and job description to get a realistic AI voice interview tailored specifically for that company.
              </p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/projects/new"
                className="w-full sm:w-auto px-6 py-3.5 bg-[#FF6B35] text-white font-[family-name:var(--font-display)] font-extrabold text-sm rounded-xl border-4 border-[#1B1F3B] shadow-[4px_4px_0_#1B1F3B] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5 stroke-[3]" />
                <span>Create Your First Project</span>
              </Link>
            </div>
          </div>
        )}

      </main>
      {/* DELETE CONFIRMATION MODAL */}
      {deletingId && (
        <div className="fixed inset-0 z-50 bg-[#1B1F3B]/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white border-4 border-[#1B1F3B] rounded-2xl p-6 max-w-md w-full shadow-[10px_10px_0_#1B1F3B] space-y-4">
            <div className="flex items-center gap-3 text-[#FF5C7A]">
              <AlertCircle className="w-6 h-6 stroke-[2.5]" />
              <h3 className="font-[family-name:var(--font-display)] font-extrabold text-lg text-[#1B1F3B]">
                Delete Project?
              </h3>
            </div>
            <p className="text-sm font-medium text-[#1B1F3B]/80">
              Are you sure you want to delete this project? Your past interview history will be soft-deleted.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 bg-white text-[#1B1F3B] font-bold text-xs rounded-xl border-2 border-[#1B1F3B] hover:bg-[#F5EBE0]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteProject(deletingId)}
                className="px-5 py-2 bg-[#FF5C7A] text-white font-bold text-xs rounded-xl border-2 border-[#1B1F3B] shadow-[2px_2px_0_#1B1F3B]"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
