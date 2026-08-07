import { supabase } from './client';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  org_id: string | null;
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
      system_design?: boolean;
    };
  };
  onboarding: Record<string, any>;
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
  company_profile?: any;
  jd_profile?: any;
  gap_report?: any;
  strategy?: any;
  readiness: {
    overall?: number;
    resume_match?: number;
    technical?: number;
    behavioral?: number;
    coding?: number;
    system_design?: number;
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
  prep_error?: any;
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
  meta: Record<string, any>;
  created_at: string;
}

// Check if Supabase client is connected with valid credentials
export const isSupabaseConfigured = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes('placeholder'));
};

// Initial Mock Data Fallbacks for local demo mode before keys are provided
export const MOCK_PROFILE: Profile = {
  id: 'usr_demo_123',
  email: 'candidate@devtrackacademy.com',
  full_name: 'Alex Chen',
  avatar_url: null,
  org_id: null,
  credits_balance: 4,
  prefs: {
    language: 'en-IN',
    voice_id: 'interviewer_warm_professional_en_IN',
    persona: 'warm_professional',
    theme: 'system',
    defaults: {
      difficulty: 'medium',
      duration_min: 15,
      coding: true,
      system_design: false,
    },
  },
  onboarding: { completed: true },
  created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
};

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj_google_sr_swe',
    user_id: 'usr_demo_123',
    company_name: 'Google',
    company_domain: 'google.com',
    company_logo_url: 'https://www.google.com/favicon.ico',
    role_title: 'Senior Software Engineer, Cloud Infra',
    seniority: 'Senior',
    status: 'ready',
    active_resume_id: 'res_1',
    jd_raw: 'We are seeking a Senior Software Engineer to design distributed systems in Cloud Infrastructure...',
    readiness: {
      overall: 82,
      resume_match: 88,
      technical: 84,
      behavioral: 90,
      coding: 76,
      system_design: 68,
      history: [
        { session_id: 'sess_1', overall: 68, at: '2026-07-20' },
        { session_id: 'sess_2', overall: 75, at: '2026-07-28' },
        { session_id: 'sess_3', overall: 82, at: '2026-08-05' },
      ],
    },
    stats: {
      sessions_count: 3,
      avg_score: 75.0,
      best_score: 82,
      last_score: 82,
      total_minutes: 45,
      credits_spent: 9,
    },
    readiness_overall: 82,
    sessions_count: 3,
    avg_score: 75.0,
    last_session_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    deleted_at: null,
    created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'proj_stripe_staff_backend',
    user_id: 'usr_demo_123',
    company_name: 'Stripe',
    company_domain: 'stripe.com',
    company_logo_url: 'https://stripe.com/favicon.ico',
    role_title: 'Backend Engineer, Payments Core',
    seniority: 'Mid-Senior',
    status: 'ready',
    active_resume_id: 'res_2',
    jd_raw: 'Join Stripe Payments Core team building reliable distributed payment processing engines...',
    readiness: {
      overall: 65,
      resume_match: 78,
      technical: 62,
      behavioral: 85,
      coding: 60,
      system_design: 45,
    },
    stats: {
      sessions_count: 2,
      avg_score: 63.5,
      best_score: 65,
      last_score: 65,
      total_minutes: 30,
      credits_spent: 6,
    },
    readiness_overall: 65,
    sessions_count: 2,
    avg_score: 63.5,
    last_session_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    deleted_at: null,
    created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'proj_meta_tech_lead',
    user_id: 'usr_demo_123',
    company_name: 'Meta',
    company_domain: 'meta.com',
    company_logo_url: 'https://meta.com/favicon.ico',
    role_title: 'Full Stack Engineer, AI Tools',
    seniority: 'Senior',
    status: 'preparing',
    active_resume_id: 'res_3',
    jd_raw: 'Building next generation web interfaces for generative AI development...',
    readiness: {
      overall: 0,
      resume_match: 0,
    },
    stats: {
      sessions_count: 0,
      avg_score: 0,
      best_score: 0,
      last_score: 0,
    },
    readiness_overall: null,
    sessions_count: 0,
    avg_score: null,
    last_session_at: null,
    deleted_at: null,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'proj_uber_lead_arch',
    user_id: 'usr_demo_123',
    company_name: 'Uber',
    company_domain: 'uber.com',
    company_logo_url: 'https://uber.com/favicon.ico',
    role_title: 'Staff Platform Systems Engineer',
    seniority: 'Staff',
    status: 'draft',
    active_resume_id: null,
    jd_raw: 'Architect high-throughput real-time routing platforms...',
    readiness: {},
    stats: { sessions_count: 0 },
    readiness_overall: null,
    sessions_count: 0,
    avg_score: null,
    last_session_at: null,
    deleted_at: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
];

export const MOCK_LEDGER: CreditLedgerItem[] = [
  {
    id: 104,
    user_id: 'usr_demo_123',
    kind: 'spend',
    amount: -3,
    balance_after: 4,
    session_id: 'sess_3',
    meta: { breakdown: { voice: 2, coding: 1 }, role: 'Senior Software Engineer' },
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 103,
    user_id: 'usr_demo_123',
    kind: 'spend',
    amount: -3,
    balance_after: 7,
    session_id: 'sess_2',
    meta: { breakdown: { voice: 2, coding: 1 }, role: 'Backend Engineer' },
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 102,
    user_id: 'usr_demo_123',
    kind: 'purchase',
    amount: 9,
    balance_after: 10,
    session_id: null,
    meta: { pack: 'Placement Season Pack', provider: 'Stripe' },
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 101,
    user_id: 'usr_demo_123',
    kind: 'grant',
    amount: 1,
    balance_after: 1,
    session_id: null,
    meta: { reason: 'Welcome bonus credit on signup' },
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// --- DB API Functions ---

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
  
  // Return local storage or default fallback
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('dta_user_profile');
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
  }
  return MOCK_PROFILE;
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
  if (typeof window !== 'undefined') {
    localStorage.setItem('dta_user_profile', JSON.stringify(updated));
  }
  return updated;
}

export async function fetchUserProjects(userId?: string): Promise<Project[]> {
  if (isSupabaseConfigured() && userId) {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
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

  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('dta_user_projects');
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
  }
  return MOCK_PROJECTS;
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
  if (typeof window !== 'undefined') {
    localStorage.setItem('dta_user_projects', JSON.stringify(updatedProjects));
  }
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
  if (typeof window !== 'undefined') {
    localStorage.setItem('dta_user_projects', JSON.stringify(filtered));
  }
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
