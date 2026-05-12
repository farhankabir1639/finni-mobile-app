import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { setSentryUser, clearSentryUser, captureError } from '../lib/sentry';
import { identifyUser, resetUser, trackEvent } from '../lib/analytics';

const hasSupabaseConfig = !!(
  process.env.EXPO_PUBLIC_SUPABASE_URL &&
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user?.id) {
        setSentryUser(session.user.id);
        identifyUser(session.user.id, { email: session.user.email });
      } else {
        clearSentryUser();
        resetUser();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    console.log('[AuthContext] signUp called', { email: email?.length ? '***' : '(empty)', hasPassword: !!password, hasFullName: !!fullName, hasSupabaseConfig });
    if (!hasSupabaseConfig) {
      console.error('[AuthContext] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
      return { error: new Error('App configuration error. Please check your environment variables.') };
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: fullName?.trim() ? { data: { full_name: fullName.trim() } } : undefined,
      });
      console.log('[AuthContext] signUp result', { hasUser: !!data?.user, error: error?.message ?? null });
      if (error) {
        console.warn('[AuthContext] signUp error', error.message, error);
        return { error: error as Error };
      }
      return { error: null };
    } catch (err) {
      console.error('[AuthContext] signUp exception', err);
      captureError(err, { context: 'signUp' });
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value: AuthContextType = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
