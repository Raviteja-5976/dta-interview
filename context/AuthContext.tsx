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
  verifyEmailOtp: (email: string, token: string, type?: 'email' | 'signup' | 'magiclink') => Promise<{ data: any; error: Error | null }>;
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
      },
    });
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
    });
    return { data, error };
  };

  const verifyEmailOtp = async (email: string, token: string, type: 'email' | 'signup' | 'magiclink' = 'email') => {
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
