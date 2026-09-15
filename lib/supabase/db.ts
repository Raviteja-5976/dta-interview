import { supabase } from './client';
import type {
  CompanyProfile,
  GapReport,
  JdProfile,
  Strategy,
} from '../agents/schemas';

/** Shape written by lib/pipelines/prep.ts when a preparation stage fails. */
export interface ProjectPrepError {
  stage?: string;
  message?: string;
  at?: string;
  recoverable?: boolean;
  started_at?: string;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  org_id: string | null;
  /**
   * Set by hand in Supabase, never from the app — migration 020 revokes the
   * column from `authenticated`, so an update that includes it is rejected
   * outright rather than silently ignored.
   */
  role: 'student' | 'admin';
  credits_balance: number;
  prefs: {
    language?: string;
    voice_id?: string;
    persona?: string;
    theme?: string;
    defaults?: {
      difficulty?: 'easy' | 'medium' | 'hard';
      duration_min?: number;
      coding?: boolean;
      skill_challenge?: boolean;
    };
  };
  onboarding: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  company_name: string;
  company_domain: string | null;
  company_logo_url: string | null;
  role_title: string;
  seniority: string | null;
  status: 'draft' | 'preparing' | 'ready' | 'failed' | 'archived';
  active_resume_id: string | null;
  jd_raw: string | null;
  company_profile?: CompanyProfile | null;
  jd_profile?: JdProfile | null;
  gap_report?: GapReport | null;
  strategy?: Strategy | null;
  readiness: {
    overall?: number;
    resume_match?: number;
    technical?: number;
    behavioral?: number;
    coding?: number;
    skill_challenge?: number;
    computed_at?: string;
    history?: Array<{ session_id: string; overall: number; at: string }>;
  };
  stats: {
    sessions_count?: number;
    avg_score?: number;
    best_score?: number;
    last_score?: number;
    total_minutes?: number;
    credits_spent?: number;
  };
  readiness_overall?: number | null;
  sessions_count?: number;
  avg_score?: number | null;
  last_session_at: string | null;
  prep_error?: ProjectPrepError | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditLedgerItem {
  id: number;
  user_id: string;
  kind: 'purchase' | 'grant' | 'spend' | 'refund' | 'expiry';
  amount: number;
  balance_after: number;
  session_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

// Check if Supabase client is connected with valid credentials
export const isSupabaseConfigured = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes('placeholder'));
};

// Initial Fallbacks before database connection or for new user
export const MOCK_PROFILE: Profile = {
  id: '',
  email: '',
  full_name: '',
  avatar_url: null,
  org_id: null,
  role: 'student',
  credits_balance: 100, // signup grant — see migration 014
  prefs: {
    language: 'en-IN',
    voice_id: 'interviewer_warm_professional_en_IN',
    persona: 'warm_professional',
    theme: 'system',
    defaults: {
      difficulty: 'medium',
      duration_min: 15,
      coding: true,
      skill_challenge: false,
    },
  },
  onboarding: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_PROJECTS: Project[] = [];

export const MOCK_LEDGER: CreditLedgerItem[] = [];

// --- DB API Functions ---

/**
 * ── The offline fallback cache is per user, and only ever read for that user ──
 *
 * These caches used to live under two fixed keys, `dta_user_profile` and
 * `dta_user_projects`. On a shared browser that is an identity leak: whoever
 * signed in last left their name, credits and project list behind, and the next
 * person to open the app — signed out, or signed in as somebody else whose query
 * happened to fail — was shown that stale identity as if it were their own.
 *
 * Scoping the key to the user id means a cache can only ever be read back by the
 * user who wrote it. A signed-out visitor has no id, so there is nothing to read
 * and they get the empty defaults, which is the honest answer.
 */
const CACHE_PREFIX = 'dta_user_';

const profileKey = (userId: string) => `${CACHE_PREFIX}profile:${userId}`;
const projectsKey = (userId: string) => `${CACHE_PREFIX}projects:${userId}`;

function readCache<T>(key: string | null): T | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string | null, value: unknown): void {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode, or the quota is full. A cache that cannot be written is not
    // a reason to fail the operation that produced the data.
  }
}

/**
 * Drop every cached identity in this browser. Called on sign-out, including a
 * sign-out that happened in another tab, so nothing of the previous session is
 * left behind for the next person to find.
 */
export function clearLocalUserCache(): void {
  if (typeof window === 'undefined') return;
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing readable means nothing to clear.
  }
}

/**
 * The dashboard tile projection. Must stay a single string literal — supabase-js
 * parses it at the type level, and concatenation degrades the result to `string`.
 */
const PROJECT_TILE_COLUMNS =
  'id, user_id, company_name, company_domain, company_logo_url, role_title, seniority, status, active_resume_id, readiness, stats, readiness_overall, sessions_count, avg_score, last_session_at, prep_error, deleted_at, created_at, updated_at';

export async function fetchUserProfile(userId?: string): Promise<Profile> {
  if (isSupabaseConfigured() && userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) {
        return data as Profile;
      }
    } catch (err) {
      console.warn('Supabase query error, falling back to local state:', err);
    }
  }
  
  // This user's own cached copy, or the empty defaults. Never another user's.
  return readCache<Profile>(userId ? profileKey(userId) : null) ?? MOCK_PROFILE;
}

export async function updateUserProfile(userId: string, updates: Partial<Profile>): Promise<Profile> {
  if (isSupabaseConfigured() && userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select()
        .single();

      if (!error && data) {
        return data as Profile;
      }
    } catch (err) {
      console.warn('Supabase profile update failed:', err);
    }
  }

  // Fallback update local storage
  const current = await fetchUserProfile(userId);
  const updated = { ...current, ...updates, updated_at: new Date().toISOString() };
  writeCache(userId ? profileKey(userId) : null, updated);
  return updated;
}

export async function fetchUserProjects(userId?: string): Promise<Project[]> {
  if (isSupabaseConfigured() && userId) {
    try {
      // Explicit column list, never `select *`. A projects row carries
      // company_profile, jd_profile, gap_report and strategy — tens of KB of
      // TOASTed JSONB that a dashboard tile never reads. Naming the columns is
      // what keeps this query touching only the ~200-byte main tuple
      // (db-design.md §1.2), and it is the single discipline the whole
      // JSONB-heavy design depends on.
      const { data, error } = await supabase
        .from('projects')
        .select(PROJECT_TILE_COLUMNS)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (!error && data) {
        return data as Project[];
      }
    } catch (err) {
      console.warn('Supabase projects query failed, falling back to local state:', err);
    }
  }

  return readCache<Project[]>(userId ? projectsKey(userId) : null) ?? MOCK_PROJECTS;
}

export async function createProject(userId: string, newProj: Partial<Project>): Promise<Project> {
  const projectObj: Partial<Project> = {
    user_id: userId || 'usr_demo_123',
    company_name: newProj.company_name || 'Acme Inc',
    company_domain: newProj.company_domain || null,
    company_logo_url: newProj.company_domain ? `https://${newProj.company_domain}/favicon.ico` : null,
    role_title: newProj.role_title || 'Software Engineer',
    seniority: newProj.seniority || 'Mid-Level',
    status: 'preparing',
    jd_raw: newProj.jd_raw || null,
    readiness: { overall: 0 },
    stats: { sessions_count: 0, avg_score: 0 },
    last_session_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured() && userId) {
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert(projectObj)
        .select()
        .single();

      if (!error && data) {
        return data as Project;
      }
    } catch (err) {
      console.warn('Supabase create project failed:', err);
    }
  }

  // Local state fallback
  const created: Project = {
    ...(projectObj as Project),
    id: `proj_${Date.now()}`,
    deleted_at: null,
  };

  const existing = await fetchUserProjects(userId);
  const updatedProjects = [created, ...existing];
  writeCache(userId ? projectsKey(userId) : null, updatedProjects);
  return created;
}

export async function deleteProject(userId: string, projectId: string): Promise<boolean> {
  if (isSupabaseConfigured() && userId) {
    try {
      const { error } = await supabase
        .from('projects')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', projectId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Supabase delete project failed:', err);
    }
  }

  const existing = await fetchUserProjects(userId);
  const filtered = existing.filter((p) => p.id !== projectId);
  writeCache(userId ? projectsKey(userId) : null, filtered);
  return true;
}

export async function fetchCreditLedger(userId?: string): Promise<CreditLedgerItem[]> {
  if (isSupabaseConfigured() && userId) {
    try {
      const { data, error } = await supabase
        .from('credit_ledger')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        return data as CreditLedgerItem[];
      }
    } catch (err) {
      console.warn('Supabase ledger query failed:', err);
    }
  }
  return MOCK_LEDGER;
}
