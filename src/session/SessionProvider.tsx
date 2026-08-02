import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { clearStoredSession, getStoredSession, storeSession, type Session } from './session';

interface SessionContextValue {
  session: Session | null;
  isLoading: boolean;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getStoredSession().then((stored) => {
      setSession(stored);
      setIsLoading(false);
    });
  }, []);

  const signIn = async (newSession: Session) => {
    await storeSession(newSession);
    setSession(newSession);
  };

  const signOut = async () => {
    await clearStoredSession();
    setSession(null);
  };

  return (
    <SessionContext.Provider value={{ session, isLoading, signIn, signOut }}>
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
