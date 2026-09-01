import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { StartupScreen } from '../../src/components/StartupScreen';
import { useDeepLink } from '../../src/deepLinks/DeepLinkProvider';
import { isWellFormedInvitationToken } from '../../src/deepLinks/parseInvitationLink';
import { useHousehold } from '../../src/household/HouseholdProvider';
import { useSession } from '../../src/session/SessionProvider';

/**
 * Gives expo-router somewhere to send `keepsake:///invite/<token>`, and
 * hands the token to DeepLinkProvider before letting routing continue.
 *
 * The ordering is the point. Redirecting straight away would race
 * getInitialURL()'s promise, and onboarding mounting without a token
 * shows "Create a household" — irreversible, since ADR-0004 has no leave
 * path. So this waits for the provider to actually hold this token, then
 * redirects.
 *
 * It has to redirect to the route the invitee's *current* state can
 * actually reach, not a fixed "/". AuthenticatedRouteBoundary's three
 * branches are `Stack.Protected` guards, and a runtime navigation to a
 * screen whose guard is false is silently dropped — unlike the initial
 * URL, which expo-router resolves against the available screens and
 * falls back for. "/" is `(tabs)`, guarded on being fully onboarded, so
 * for the two states an invitee is actually in — signed out, or signed
 * in mid-onboarding — the replace did nothing, this screen stayed
 * mounted, and `Redirect` renders null: a blank screen (live test,
 * 2026-08-31). It looked verified because it was only ever tapped from
 * an already-onboarded device, the one state where "/" exists.
 *
 * The three branches below mirror that boundary's three guards, and
 * `src/navigation/inviteRoute.*.test.tsx` pins each one so they can't
 * drift apart silently. Loading and load-error states are deliberately
 * absent: the boundary returns StartupScreen / ErrorState *instead of*
 * the Stack, so this screen only ever renders once session and household
 * have settled.
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
