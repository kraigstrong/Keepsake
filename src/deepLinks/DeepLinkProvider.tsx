import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { isWellFormedInvitationToken, parseInvitationLink } from './parseInvitationLink';

interface DeepLinkContextValue {
  pendingInvitationToken: string | null;
  clearPendingInvitationToken: () => void;
  /**
   * Capture a token already extracted from a route param, so a caller
   * holding one need not wait on the asynchronous Linking path below.
   * Returns whether the token was well-formed enough to keep.
   */
  capturePendingInvitationToken: (token: string) => boolean;
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

  // getInitialURL() above resolves a promise, so on a cold launch the
  // token can still be null several renders in. app/invite/[token].tsx
  // already holds it synchronously from the route param and uses this to
  // put it here before handing control back to the router — without that,
  // onboarding can mount with no token and expose "Create a household",
  // which is the one irreversible action in the app (ADR-0004: no leaving).
  // useCallback so the route's effect doesn't re-run every render.
  const capturePendingInvitationToken = useCallback((token: string): boolean => {
    if (!isWellFormedInvitationToken(token)) return false;
    setPendingInvitationToken(token);
    return true;
  }, []);

  return (
    <DeepLinkContext.Provider
      value={{
        pendingInvitationToken,
        clearPendingInvitationToken,
        capturePendingInvitationToken,
      }}
    >
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
