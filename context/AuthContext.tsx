'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';

type AuthTab = 'login' | 'signup';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthModalOpen: boolean;
  authTab: AuthTab;
  setAuthTab: (tab: AuthTab) => void;
  openAuthModal: (tab?: AuthTab) => void;
  closeAuthModal: () => void;
  signOut: () => Promise<{ error: Error | null }>;
  signUpWithEmail: (fullName: string, email: string, password: string) => Promise<{ data: any; error: Error | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ data: any; error: Error | null }>;
  signInWithOAuth: (provider: 'google' | 'github') => Promise<{ data: any; error: Error | null }>;
  sendOtp: (email: string) => Promise<{ data: any; error: Error | null }>;
  verifyEmailOtp: (email: string, token: string, type?: 'email' | 'signup' | 'magiclink' | 'recovery') => Promise<{ data: any; error: Error | null }>;
  // `unknown` rather than the `any` above: every caller of these three reads
  // `error` and nothing else, so there is no reason to hand out an escape hatch.
  /** Re-send the signup confirmation email. Not the same as sending a fresh magic link. */
  resendSignupEmail: (email: string) => Promise<{ data: unknown; error: Error | null }>;
  /** Step 1 of forgot-password: emails a recovery link. */
  sendPasswordReset: (email: string) => Promise<{ data: unknown; error: Error | null }>;
  /** Step 2: called from /auth/reset-password, where a recovery session exists. */
  updatePassword: (password: string) => Promise<{ data: unknown; error: Error | null }>;
}

/**
 * Where a link in an email lands.
 *
 * Everything email-borne goes through /auth/confirm, which understands both the
 * `token_hash` templates and the default `{{ .ConfirmationURL }}` one. `next` is
 * where the user ends up once the session exists.
 *
 * Built from `window.location.origin` rather than an env var so it is correct on
 * localhost, on a preview deploy, and in production without three configs to
 * keep in step. Supabase still refuses any redirect not on its allow-list.
 */
function confirmUrl(next: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<AuthTab>('login');

  useEffect(() => {
    // 1. Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        setUser(session?.user ?? null);
      } catch (err) {
        console.error('Error fetching initial session:', err);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    // 2. Listen to auth state changes for seamless session persistence
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const openAuthModal = (tab: AuthTab = 'login') => {
    setAuthTab(tab);
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
  };

  const signUpWithEmail = async (fullName: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        // Without this the link in the confirmation email goes to whatever Site
        // URL the Supabase project has, which on localhost is the production
        // site — you click the link and land somewhere else entirely.
        emailRedirectTo: confirmUrl('/dashboard'),
      },
    });
    return { data, error };
  };

  const resendSignupEmail = async (email: string) => {
    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: confirmUrl('/dashboard') },
    });
    return { data, error };
  };

  const sendPasswordReset = async (email: string) => {
    // Lands on /auth/confirm, which establishes the recovery session and then
    // forwards to the page that actually takes the new password.
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: confirmUrl('/auth/reset-password'),
    });
    return { data, error };
  };

  const updatePassword = async (password: string) => {
    const { data, error } = await supabase.auth.updateUser({ password });
    return { data, error };
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const sendOtp = async (email: string) => {
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Same reason as signUp: without this the magic link in that email goes
        // to the project's Site URL, so a link generated while developing on
        // localhost drops you on the production site.
        emailRedirectTo: confirmUrl('/dashboard'),
      },
    });
    return { data, error };
  };

  const verifyEmailOtp = async (
    email: string,
    token: string,
    type: 'email' | 'signup' | 'magiclink' | 'recovery' = 'email',
  ) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type,
    });
    return { data, error };
  };

  const signInWithOAuth = async (provider: 'google' | 'github') => {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}` : undefined;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setUser(null);
      setSession(null);
    }
    return { error };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isAuthModalOpen,
        authTab,
        setAuthTab,
        openAuthModal,
        closeAuthModal,
        signOut,
        signUpWithEmail,
        signInWithEmail,
        signInWithOAuth,
        sendOtp,
        verifyEmailOtp,
        resendSignupEmail,
        sendPasswordReset,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
