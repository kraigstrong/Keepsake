import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../supabase/instance';

interface SessionContextValue {
  session: Session | null;
  isLoading: boolean;
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, code: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    // Fires on sign-in, sign-out, and token refresh — the single source
    // of truth for session state; sendOtp/verifyOtp/signOut below don't
    // set state directly, they just trigger this.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    // supabase-js's autoRefreshToken timer doesn't reliably fire while
    // the JS runtime is backgrounded on mobile (no such issue on web) —
    // Supabase's own React Native guidance is to drive it from AppState
    // instead of relying on the timer alone.
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, []);

  const sendOtp = async (email: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    return { error: error?.message ?? null };
  };

  const verifyOtp = async (email: string, code: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    return { error: error?.message ?? null };
  };

  const signOut = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  return (
    <SessionContext.Provider value={{ session, isLoading, sendOtp, verifyOtp, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
