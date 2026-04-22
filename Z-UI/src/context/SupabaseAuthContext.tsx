import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import type { AuthResponse, Session, SignUpWithPasswordCredentials, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface SupabaseAuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResponse['data']>;
  signUp: (
    email: string,
    password: string,
    options?: SignUpWithPasswordCredentials extends { options?: infer Options } ? Options : never,
  ) => Promise<AuthResponse['data']>;
  signOut: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SupabaseAuthContextValue>(() => ({
    user: session?.user ?? null,
    session,
    loading,
    signIn: async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    signUp: async (email: string, password: string, options) => {
      const { data, error } = await supabase.auth.signUp({ email, password, options });
      if (error) throw error;
      return data;
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [loading, session]);

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(SupabaseAuthContext);
  if (!ctx) throw new Error('useAuth must be used within SupabaseAuthProvider');
  return ctx;
}
