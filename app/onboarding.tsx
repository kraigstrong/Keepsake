import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../src/components/Button';
import { useDeepLink } from '../src/deepLinks/DeepLinkProvider';
import {
  isWellFormedInvitationToken,
  parseInvitationLink,
} from '../src/deepLinks/parseInvitationLink';
import { useHousehold, type AcceptInvitationResult } from '../src/household/HouseholdProvider';
import { colors, spacing, typography } from '../src/theme/tokens';

/**
 * Two independent steps, gated by what's still missing (prd.md §26
 * "User"/"Household" entities): a display name (profiles), then either
 * accepting a pending invitation link or creating a new household —
 * MVP excludes multiple households (prd.md §5), so this is a one-time
 * screen, not something a member revisits.
 *
 * The household step is a state machine, not a button. Its states and
 * transitions are #157's table; the invariant underneath all of them is
 * that a pending token is only ever cleared deliberately, because
 * "Create a household" cannot be undone (ADR-0004) and is the screen a
 * forgotten token drops someone onto.
 */
export default function OnboardingScreen() {
  const { profile, household, setDisplayName } = useHousehold();
  const { pendingInvitationToken } = useDeepLink();

  if (!profile) {
    return (
      <ProfileSetupStep
        onSubmit={setDisplayName}
        hasPendingInvitation={pendingInvitationToken !== null}
      />
    );
  }
  if (!household) {
    return <HouseholdSetupStep />;
  }
  // Both exist — HouseholdProvider's refresh() already updated state, and
  // app/_layout.tsx's guard will navigate away on its own next render.
  return null;
}

function ProfileSetupStep({
  onSubmit,
  hasPendingInvitation,
}: {
  onSubmit: (displayName: string) => Promise<{ error: string | null }>;
  hasPendingInvitation: boolean;
}) {
  const [displayName, setDisplayNameInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    const { error: submitError } = await onSubmit(displayName.trim());
    setIsSubmitting(false);
    if (submitError) setError(submitError);
  };

  return (
    <View style={styles.container} testID="onboarding-profile-step">
      <Text style={styles.title}>What should we call you?</Text>
      {/* The invitation is accepted a step later, in HouseholdSetupStep,
          which isn't mounted until a profile exists. Without this the
          invitee sees a bare name prompt and no sign the link worked —
          and the natural read of silence is that it didn't. */}
      {hasPendingInvitation && (
        <Text style={styles.note} testID="onboarding-invitation-pending-note">
          Your invitation is saved. We&rsquo;ll use it as soon as you continue.
        </Text>
      )}
      <TextInput
        testID="onboarding-display-name-input"
        style={styles.input}
        placeholder="Your name"
        placeholderTextColor={colors.textTertiary}
        value={displayName}
        onChangeText={setDisplayNameInput}
        autoCapitalize="words"
        editable={!isSubmitting}
      />
      <Button
        testID="onboarding-save-name-button"
        title="Continue"
        onPress={handleSubmit}
        disabled={isSubmitting || displayName.trim().length === 0}
      />
      {error && (
        <Text
          style={styles.error}
          testID="onboarding-profile-error"
          accessible
          accessibilityRole="alert"
        >
          {error}
        </Text>
      )}
    </View>
  );
}

/** Which face of the household step the user has navigated to. */
type Mode = 'choosing' | 'entering-token' | 'confirming-create';

/**
 * Reads a pasted invitation as either a full `keepsake://invite/<token>`
 * link or the bare token, because people paste whichever half they can
 * select. Shape only — validity stays server-side.
 */
function readPastedInvitation(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const parsed = parseInvitationLink(trimmed);
  if (parsed.ok) return parsed.token;
  return isWellFormedInvitationToken(trimmed) ? trimmed : null;
}

function HouseholdSetupStep() {
  const { createHousehold, acceptInvitation, retryLoad } = useHousehold();
  const { pendingInvitationToken, clearPendingInvitationToken } = useDeepLink();
  const [mode, setMode] = useState<Mode>('choosing');
  const [outcome, setOutcome] = useState<{ token: string; value: AcceptInvitationResult } | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  // Derived rather than stored: setting an "accepting" flag inside the
  // effect below would run before its first await, i.e. not actually
  // deferred, which is what react-hooks/set-state-in-effect flags.
  const awaitingAutoAccept =
    pendingInvitationToken !== null && outcome?.token !== pendingInvitationToken;
  const isAccepting = awaitingAutoAccept || isSubmitting;

  // Applying the outcome is what decides whether the token survives.
  // Only `terminal` and success clear it, so a dropped connection leaves
  // it spendable on Retry rather than dropping the invitee onto
  // "Create a household" — irreversible under ADR-0004.
  const applyOutcome = (token: string, value: AcceptInvitationResult) => {
    if (value.outcome !== 'retryable') clearPendingInvitationToken();
    setOutcome({ token, value });
  };

  useEffect(() => {
    if (!pendingInvitationToken) return;
    if (outcome?.token === pendingInvitationToken) return;

    let cancelled = false;
    acceptInvitation(pendingInvitationToken).then((value) => {
      if (cancelled) return;
      applyOutcome(pendingInvitationToken, value);
    });

    return () => {
      cancelled = true;
    };
    // Deliberately runs once per pending token — re-running on every
    // render would re-accept the same token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvitationToken]);

  const attempt = async (token: string) => {
    setError(null);
    setIsSubmitting(true);
    const value = await acceptInvitation(token);
    applyOutcome(token, value);
    setIsSubmitting(false);
  };

  const handleCreate = async () => {
    setError(null);
    setIsCreating(true);
    const { error: createError } = await createHousehold();
    setIsCreating(false);
    if (createError) {
      setMode('choosing');
      setError(createError);
    }
  };

  if (isAccepting) {
    return (
      <View style={styles.container} testID="onboarding-accepting-invitation">
        <ActivityIndicator role="progressbar" accessible />
        <Text style={styles.title}>Joining your household…</Text>
      </View>
    );
  }

  const settled = outcome?.value;

  // The membership row exists. Sending this person to "Create a
  // household" would put them in a second household they can never
  // leave, so the only action offered is another read.
  if (settled?.outcome === 'joined-refresh-failed') {
    return (
      <View style={styles.container} testID="onboarding-joined-refresh-failed">
        <Text style={styles.title}>You&rsquo;re in</Text>
        <Text style={styles.note} accessible accessibilityRole="alert">
          {settled.message}
        </Text>
        <Button title="Try again" onPress={retryLoad} testID="onboarding-joined-retry-button" />
      </View>
    );
  }

  if (settled?.outcome === 'retryable' && outcome) {
    return (
      <View style={styles.container} testID="onboarding-invitation-retryable">
        <Text style={styles.title}>We couldn&rsquo;t finish just yet</Text>
        <Text style={styles.note} accessible accessibilityRole="alert">
          {settled.message}
        </Text>
        <Button
          title="Try again"
          onPress={() => attempt(outcome.token)}
          testID="onboarding-invitation-retry-button"
        />
      </View>
    );
  }

  if (settled?.outcome === 'terminal') {
    return (
      <View style={styles.container} testID="onboarding-invitation-terminal">
        <Text style={styles.title}>That invitation didn&rsquo;t work</Text>
        <Text style={styles.note} accessible accessibilityRole="alert">
          {settled.message}
        </Text>
        <Button
          title="Continue"
          onPress={() => {
            setOutcome(null);
            setMode('choosing');
          }}
          testID="onboarding-invitation-terminal-continue"
        />
      </View>
    );
  }

  if (mode === 'entering-token') {
    const token = readPastedInvitation(tokenInput);
    return (
      <View style={styles.container} testID="onboarding-enter-invitation-step">
        <Text style={styles.title}>Paste your invitation</Text>
        <Text style={styles.note}>
          The whole link works, and so does just the code at the end of it.
        </Text>
        <TextInput
          testID="onboarding-invitation-input"
          style={styles.input}
          placeholder="keepsake://invite/…"
          placeholderTextColor={colors.textTertiary}
          value={tokenInput}
          onChangeText={setTokenInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          testID="onboarding-invitation-submit-button"
          title="Join household"
          onPress={() => token && attempt(token)}
          disabled={token === null}
        />
        <Button
          testID="onboarding-invitation-cancel-button"
          title="Back"
          variant="secondary"
          onPress={() => setMode('choosing')}
        />
      </View>
    );
  }

  // Creating is the one irreversible action in the app: there is no
  // leave path (ADR-0004), so a mis-tap here needs a database edit to
  // undo. It gets a deliberate second step rather than firing on one tap.
  if (mode === 'confirming-create') {
    return (
      <View style={styles.container} testID="onboarding-confirm-create-step">
        <Text style={styles.title}>Start a new household?</Text>
        <Text style={styles.note}>
          You can&rsquo;t join someone else&rsquo;s afterwards — Keepsake gives each account one
          household. If you&rsquo;re expecting an invitation, use it first.
        </Text>
        <Button
          testID="onboarding-confirm-create-button"
          title="Create a household"
          onPress={handleCreate}
          disabled={isCreating}
        />
        <Button
          testID="onboarding-cancel-create-button"
          title="Not yet"
          variant="secondary"
          onPress={() => setMode('choosing')}
          disabled={isCreating}
        />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="onboarding-household-step">
      <Text style={styles.title}>Set up your household</Text>
      <Button
        testID="onboarding-have-invitation-button"
        title="I have an invitation"
        onPress={() => setMode('entering-token')}
      />
      <Button
        testID="onboarding-create-household-button"
        title="Create a household"
        variant="secondary"
        onPress={() => setMode('confirming-create')}
      />
      {error && (
        <Text
          style={styles.error}
          testID="onboarding-household-error"
          accessible
          accessibilityRole="alert"
        >
          {error}
        </Text>
      )}
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
    marginBottom: spacing.md,
  },
  note: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  input: {
    ...typography.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
});
