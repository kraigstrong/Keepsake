import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { StartupScreen } from '../../src/components/StartupScreen';
import { useDeepLink } from '../../src/deepLinks/DeepLinkProvider';
import { isWellFormedInvitationToken } from '../../src/deepLinks/parseInvitationLink';
import { useHousehold } from '../../src/household/HouseholdProvider';
import { useSession } from '../../src/session/SessionProvider';

/**
 * Gives expo-router somewhere to send `keepsake:///invite/<token>`, then
 * hands off to AuthenticatedRouteBoundary's branches. Two invariants,
 * both load-bearing; the incident that produced them is in
 * `docs/history/cross-cutting-invite-blank-screen.md`.
 *
 * 1. Capture the token before routing on. Redirecting first races
 *    getInitialURL(), and onboarding mounting without a token shows
 *    "Create a household" — irreversible under ADR-0004.
 *
 * 2. Redirect into a branch this invitee's state can actually reach, not
 *    a fixed "/". A runtime navigation to a `Stack.Protected` screen
 *    whose guard is false is silently dropped (unlike the initial URL,
 *    which expo-router resolves against the screens that exist), and
 *    "/" is `(tabs)`, guarded on being onboarded.
 *
 * The three branches mirror that boundary's three guards;
 * `src/navigation/inviteRoute.*.test.tsx` pins each so they can't drift.
 * Loading and load-error are deliberately absent — the boundary returns
 * StartupScreen/ErrorState *instead of* the Stack, so this renders only
 * once session and household have settled.
 */
export default function InviteDeepLinkRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { pendingInvitationToken, capturePendingInvitationToken } = useDeepLink();
  const { session } = useSession();
  const { profile, household } = useHousehold();
  const usableToken =
    typeof token === 'string' && isWellFormedInvitationToken(token) ? token : null;

  useEffect(() => {
    if (usableToken) capturePendingInvitationToken(usableToken);
  }, [usableToken, capturePendingInvitationToken]);

  // Waiting on this exact token, not merely a non-null one, so a stale
  // pending token can't wave this through before the effect runs. Skipped
  // entirely when there's no usable token — routing on and letting them
  // sign in normally beats holding a splash forever.
  if (usableToken && pendingInvitationToken !== usableToken) return <StartupScreen />;

  if (session === null) return <Redirect href="/sign-in" />;
  if (profile === null || household === null) return <Redirect href="/onboarding" />;
  return <Redirect href="/" />;
}
