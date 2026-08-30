import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { StartupScreen } from '../../src/components/StartupScreen';
import { useDeepLink } from '../../src/deepLinks/DeepLinkProvider';
import { isWellFormedInvitationToken } from '../../src/deepLinks/parseInvitationLink';

/**
 * Gives expo-router somewhere to send `keepsake:///invite/<token>`, and
 * hands the token to DeepLinkProvider before letting routing continue.
 *
 * The ordering is the point. Redirecting straight away would race
 * getInitialURL()'s promise, and onboarding mounting without a token
 * shows "Create a household" — irreversible, since ADR-0004 has no leave
 * path. So this waits for the provider to actually hold this token, then
 * redirects and lets AuthenticatedRouteBoundary route as normal.
 */
export default function InviteDeepLinkRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { pendingInvitationToken, capturePendingInvitationToken } = useDeepLink();
  const usableToken =
    typeof token === 'string' && isWellFormedInvitationToken(token) ? token : null;

  useEffect(() => {
    if (usableToken) capturePendingInvitationToken(usableToken);
  }, [usableToken, capturePendingInvitationToken]);

  // Nothing to wait for when there's no usable token — routing on and
  // letting them sign in normally beats holding a splash forever.
  if (!usableToken) return <Redirect href="/" />;

  // Waiting on this exact token, not merely a non-null one, so a stale
  // pending token can't wave this through before the effect runs.
  if (pendingInvitationToken !== usableToken) return <StartupScreen />;

  return <Redirect href="/" />;
}
