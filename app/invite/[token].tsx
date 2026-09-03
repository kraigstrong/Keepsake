import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { StartupScreen } from '../../src/components/StartupScreen';
import { useDeepLink } from '../../src/deepLinks/DeepLinkProvider';
import { isWellFormedInvitationToken } from '../../src/deepLinks/parseInvitationLink';
import { useHousehold } from '../../src/household/HouseholdProvider';
import { useSession } from '../../src/session/SessionProvider';
import { colors, spacing, typography } from '../../src/theme/tokens';

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
 * The two states that end here rather than redirecting are #157's T4 and
 * T5: a member who already has a household, and a link that isn't
 * well-formed. Both used to fall through to a redirect that looked
 * identical to opening the app normally, so the invitee was told nothing
 * at all. `src/navigation/inviteRoute.*.test.tsx` pins each branch.
 * Loading and load-error are deliberately absent — the boundary returns
 * StartupScreen/ErrorState *instead of* the Stack, so this renders only
 * once session and household have settled.
 */
export default function InviteDeepLinkRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { pendingInvitationToken, capturePendingInvitationToken, clearPendingInvitationToken } =
    useDeepLink();
  const { session } = useSession();
  const { profile, household } = useHousehold();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const usableToken =
    typeof token === 'string' && isWellFormedInvitationToken(token) ? token : null;

  useEffect(() => {
    if (usableToken) capturePendingInvitationToken(usableToken);
  }, [usableToken, capturePendingInvitationToken]);

  // Navigated imperatively, not by re-rendering a <Redirect>. A Redirect
  // works on this route's *first* render, when expo-router is still
  // resolving the initial URL — but once this screen is the active one,
  // a Redirect appearing in a later render is silently dropped and the
  // button does nothing. Same shape as the guard-drop behind #139; found
  // by inviteRoute.onboardedDismiss.test.tsx, which sat on the notice.
  const continueIntoApp = () => {
    setDismissed(true);
    if (session === null) router.replace('/sign-in');
    else if (profile === null || household === null) router.replace('/onboarding');
    else router.replace('/');
  };

  // T5 — a link that never had a chance. Saying so beats routing on in
  // silence, which is indistinguishable from having opened the app.
  if (token !== undefined && usableToken === null && !dismissed) {
    return (
      <InvitationNotice
        testID="invite-malformed"
        title="That invitation link isn't valid"
        message="Ask whoever invited you to send a new link. You can still sign in and use Keepsake in the meantime."
        onContinue={continueIntoApp}
      />
    );
  }

  // Waiting on this exact token, not merely a non-null one, so a stale
  // pending token can't wave this through before the effect runs.
  if (usableToken && pendingInvitationToken !== usableToken && !dismissed) {
    return <StartupScreen />;
  }

  if (session === null) return <Redirect href="/sign-in" />;
  if (profile === null || household === null) return <Redirect href="/onboarding" />;

  // T4 — already in a household. The token is spent here deliberately:
  // it can never be applied to this account (ADR-0004: one household,
  // no leaving), so keeping it would only re-show this notice forever.
  if (usableToken && !dismissed) {
    return (
      <InvitationNotice
        testID="invite-already-in-household"
        title="You're already in a household"
        message="Keepsake gives each account one household, so this invitation can't be applied. If you meant to join a different one, ask the person who invited you."
        onContinue={() => {
          clearPendingInvitationToken();
          continueIntoApp();
        }}
      />
    );
  }

  return <Redirect href="/" />;
}

function InvitationNotice({
  title,
  message,
  onContinue,
  testID,
}: {
  title: string;
  message: string;
  onContinue: () => void;
  testID: string;
}) {
  return (
    <View style={styles.container} testID={testID}>
      <View role="alert" accessible>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
      <Button title="Continue to Keepsake" onPress={onContinue} testID={`${testID}-continue`} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
