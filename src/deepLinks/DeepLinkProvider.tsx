import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { parseInvitationLink } from './parseInvitationLink';

interface DeepLinkContextValue {
  pendingInvitationToken: string | null;
  clearPendingInvitationToken: () => void;
}

const DeepLinkContext = createContext<DeepLinkContextValue | null>(null);

function extractToken(url: string): string | null {
  const parsed = parseInvitationLink(url);
  return parsed.ok ? parsed.token : null;
}

/**
 * Mounted above SessionProvider so a link tapped before sign-in (the
 * common case — invitations are for people who don't have the app set
 * up yet) survives the sign-in flow and reaches app/onboarding.tsx.
 */
export function DeepLinkProvider({ children }: { children: ReactNode }) {
  const [pendingInvitationToken, setPendingInvitationToken] = useState<string | null>(null);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const token = extractToken(url);
      if (token) setPendingInvitationToken(token);
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const token = extractToken(url);
      if (token) setPendingInvitationToken(token);
    });

    return () => subscription.remove();
  }, []);

  const clearPendingInvitationToken = () => setPendingInvitationToken(null);

  return (
    <DeepLinkContext.Provider value={{ pendingInvitationToken, clearPendingInvitationToken }}>
      {children}
    </DeepLinkContext.Provider>
  );
}

export function useDeepLink(): DeepLinkContextValue {
  const context = useContext(DeepLinkContext);
  if (!context) {
    throw new Error('useDeepLink must be used within a DeepLinkProvider');
  }
  return context;
}
