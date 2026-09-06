import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { deleteAccount, prepareAccountDeletion, type DeletionMode } from '../account/deleteAccount';
import { Button } from '../components/Button';
import { useHousehold } from '../household/HouseholdProvider';
import { logError } from '../observability';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Account deletion's entry point (ADR-0028). Two things about the shape
 * are load-bearing rather than stylistic.
 *
 * The screen says which of the two deletions is about to happen before it
 * asks, because they differ in what the person loses: a sole member's
 * whole library goes, a shared member's stays and only their own account
 * does not. Asking "are you sure?" without saying which is asking someone
 * to consent to something they have not been told.
 *
 * And nothing destructive runs until the confirmation has been typed.
 * The `prepare` call ahead of it is a read; the Storage sweep, which does
 * destroy data, happens inside `deleteAccount` afterwards. Deciding not to
 * delete your account has to be free.
 */
const CONFIRMATION_PHRASE = 'delete';

type Stage =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'confirming'; mode: DeletionMode }
  | { kind: 'deleting' }
  | { kind: 'error'; message: string };

function describe(mode: DeletionMode): string {
  switch (mode) {
    case 'sole':
      return "You're the only person in your household, so deleting your account also deletes it — every recipe, plan, grocery list and cooking note in it, for good. Nobody else can get them back.";
    case 'shared':
      return 'Your household and its recipes stay with the people still in it, including the recipes you added — your name just comes off them. Your account, your private drafts and your access go for good.';
    case 'no_household':
      return "You're not in a household, so this deletes your account and nothing else. It cannot be undone.";
  }
}

export function DeleteAccountSection() {
  const { household } = useHousehold();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [typed, setTyped] = useState('');

  const begin = async () => {
    setStage({ kind: 'preparing' });
    try {
      const mode = await prepareAccountDeletion();
      setStage({ kind: 'confirming', mode });
    } catch (error) {
      logError(error, { context: 'DeleteAccountSection.prepare' });
      setStage({ kind: 'error', message: "We couldn't check your household just now." });
    }
  };

  const confirm = async (mode: DeletionMode) => {
    setStage({ kind: 'deleting' });
    const result = await deleteAccount(mode, household?.id ?? null);
    if (result.outcome === 'deleted') return; // signed out; the boundary navigates away
    if (result.outcome === 'stale') {
      // Somebody joined or left while the confirmation was on screen, so
      // the answer this person agreed to is no longer the one that would
      // run. Start over rather than acting on the stale one.
      setTyped('');
      setStage({
        kind: 'error',
        message: 'Your household changed while you were confirming. Please start again.',
      });
      return;
    }
    setStage({ kind: 'error', message: result.message });
  };

  if (stage.kind === 'deleting') {
    return (
      <View style={styles.section} testID="settings-delete-account-progress">
        <Text style={styles.body}>Deleting your account…</Text>
      </View>
    );
  }

  if (stage.kind === 'confirming') {
    const canConfirm = typed.trim().toLowerCase() === CONFIRMATION_PHRASE;
    return (
      <View style={styles.section} testID="settings-delete-account-confirm">
        <Text style={styles.warningTitle}>Delete your account?</Text>
        <Text style={styles.body} testID="settings-delete-account-consequence">
          {describe(stage.mode)}
        </Text>
        <Text style={styles.body}>
          Type <Text style={styles.phrase}>{CONFIRMATION_PHRASE}</Text> to confirm.
        </Text>
        <TextInput
          testID="settings-delete-account-input"
          style={styles.input}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={CONFIRMATION_PHRASE}
          placeholderTextColor={colors.textTertiary}
        />
        <Button
          testID="settings-delete-account-confirm-button"
          title="Delete my account"
          onPress={() => confirm(stage.mode)}
          disabled={!canConfirm}
        />
        <Button
          testID="settings-delete-account-cancel-button"
          title="Keep my account"
          variant="secondary"
          onPress={() => {
            setTyped('');
            setStage({ kind: 'idle' });
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Account</Text>
      <Button
        testID="settings-delete-account-button"
        title="Delete account"
        variant="secondary"
        onPress={begin}
        disabled={stage.kind === 'preparing'}
      />
      {stage.kind === 'error' && (
        <Text
          style={styles.error}
          testID="settings-delete-account-error"
          accessible
          accessibilityRole="alert"
        >
          {stage.message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    paddingBottom: spacing.sm,
  },
  warningTitle: {
    ...typography.heading,
    color: colors.danger,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  phrase: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
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
  },
});
