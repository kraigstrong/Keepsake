import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../src/components/Button';
import { useDeepLink } from '../src/deepLinks/DeepLinkProvider';
import { useHousehold } from '../src/household/HouseholdProvider';
import { colors, spacing, typography } from '../src/theme/tokens';

/**
 * Two independent steps, gated by what's still missing (prd.md §26
 * "User"/"Household" entities): a display name (profiles), then either
 * accepting a pending invitation link or creating a new household —
 * MVP excludes multiple households (prd.md §5), so this is a one-time
 * screen, not something a member revisits.
 */
export default function OnboardingScreen() {
  const { profile, household, setDisplayName, createHousehold, acceptInvitation } = useHousehold();

  if (!profile) {
    return <ProfileSetupStep onSubmit={setDisplayName} />;
  }
  if (!household) {
    return (
      <HouseholdSetupStep
        onCreateHousehold={createHousehold}
        onAcceptInvitation={acceptInvitation}
      />
    );
  }
  // Both exist — HouseholdProvider's refresh() already updated state, and
  // app/_layout.tsx's guard will navigate away on its own next render.
  return null;
}

function ProfileSetupStep({
  onSubmit,
}: {
  onSubmit: (displayName: string) => Promise<{ error: string | null }>;
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

function HouseholdSetupStep({
  onCreateHousehold,
  onAcceptInvitation,
}: {
  onCreateHousehold: () => Promise<{ error: string | null }>;
  onAcceptInvitation: (token: string) => Promise<{ error: string | null }>;
}) {
  const { pendingInvitationToken, clearPendingInvitationToken } = useDeepLink();
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // isAcceptingInvite is deliberately derived from pendingInvitationToken
  // rather than its own state — setting state synchronously inside this
  // effect (to flip a loading flag on) would run before the accept call's
  // first await, i.e. not actually deferred, which is exactly what
  // react-hooks/set-state-in-effect flags.
  useEffect(() => {
    if (!pendingInvitationToken) return;

    let cancelled = false;
    onAcceptInvitation(pendingInvitationToken).then(({ error: acceptError }) => {
      if (cancelled) return;
      clearPendingInvitationToken();
      if (acceptError) setError(acceptError);
    });

    return () => {
      cancelled = true;
    };
    // Deliberately runs once per pending token — clearPendingInvitationToken
    // and onAcceptInvitation are stable enough across a single mount that
    // re-running this on every render would just re-accept the same token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvitationToken]);

  if (pendingInvitationToken) {
    return (
      <View style={styles.container} testID="onboarding-accepting-invitation">
        <ActivityIndicator role="progressbar" accessible />
        <Text style={styles.title}>Joining your household…</Text>
      </View>
    );
  }

  const handleCreate = async () => {
    setError(null);
    setIsCreating(true);
    const { error: createError } = await onCreateHousehold();
    setIsCreating(false);
    if (createError) setError(createError);
  };

  return (
    <View style={styles.container} testID="onboarding-household-step">
      <Text style={styles.title}>Set up your household</Text>
      <Button
        testID="onboarding-create-household-button"
        title="Create a household"
        onPress={handleCreate}
        disabled={isCreating}
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
