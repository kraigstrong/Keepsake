import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import {
  deleteAccount,
  prepareAccountDeletion,
  type DeletionMode,
  type DeletionPlan,
} from '../account/deleteAccount';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
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
 *
 * The confirmation is a Sheet rather than more of this inline section
 * (#193). Typing the phrase raised the keyboard over the confirm button
 * and the consequence text, because this section renders below
 * everything else on Settings — and Settings' own keyboard handling
 * (`automaticallyAdjustKeyboardInsets`, #128) insets the scroll view
 * without bringing a focused input into view, so the way out was to
 * scroll while typing. Sheet already solves this, with a
 * KeyboardAvoidingView added after live testing for exactly this class
 * of problem, and being a Modal it works the same from onboarding's
 * non-scrolling container as from Settings' scroll view — this section
 * renders in both.
 */
const CONFIRMATION_PHRASE = 'delete';

type Stage =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'confirming'; plan: DeletionPlan }
  | { kind: 'deleting' }
  | { kind: 'error'; message: string; afterConfirming: boolean };

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
  const { height: windowHeight } = useWindowDimensions();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [typed, setTyped] = useState('');

  const begin = async () => {
    setStage({ kind: 'preparing' });
    try {
      const plan = await prepareAccountDeletion();
      setStage({ kind: 'confirming', plan });
    } catch (error) {
      logError(error, { context: 'DeleteAccountSection.prepare' });
      setStage({
        kind: 'error',
        message: "We couldn't check your household just now.",
        afterConfirming: false,
      });
    }
  };

  const confirm = async (plan: DeletionPlan) => {
    setStage({ kind: 'deleting' });
    // plan.householdId, not the provider's: the server answer is the one
    // the sweep has to act on (see DeletionPlan).
    const result = await deleteAccount(plan.mode, plan.householdId);
    if (result.outcome === 'deleted') return; // signed out; the boundary navigates away
    if (result.outcome === 'stale') {
      // Somebody joined or left while the confirmation was on screen, so
      // the answer this person agreed to is no longer the one that would
      // run. Start over rather than acting on the stale one.
      setTyped('');
      setStage({
        kind: 'error',
        message: 'Your household changed while you were confirming. Please start again.',
        afterConfirming: true,
      });
      return;
    }
    setStage({ kind: 'error', message: result.message, afterConfirming: true });
  };

  // Backdrop taps and drag-down land here too. Dismissing is the safe
  // outcome — it is what "Keep my account" does — but it must not be
  // reachable while the deletion is actually running.
  const dismiss = () => {
    if (stage.kind === 'deleting') return;
    setTyped('');
    setStage({ kind: 'idle' });
  };

  // A failure after the phrase was typed stays in the sheet. Closing it
  // to show the message back in the section would put it at the bottom
  // of Settings' scroll view, out of sight of someone who is looking at
  // the sheet — and the stale-household message in particular exists to
  // be read before starting again.
  const failedWhileConfirming = stage.kind === 'error' && stage.afterConfirming;

  // The sheet covers this button, but "covered by a modal" is not the
  // same as "cannot be activated" — assistive technology and Android's
  // back-dismiss can reach what is behind one. It used to be unmounted
  // in these stages, because the confirming and deleting views replaced
  // the whole section; now that they sit in a sheet above it, it has to
  // say so itself. Re-entering `begin()` mid-deletion would otherwise
  // swap the progress view for a fresh prepare while the deletion this
  // person already confirmed was still running.
  const canBegin = stage.kind === 'idle' || (stage.kind === 'error' && !stage.afterConfirming);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Account</Text>
      <Button
        testID="settings-delete-account-button"
        title="Delete account"
        variant="secondary"
        onPress={begin}
        disabled={!canBegin}
      />
      {stage.kind === 'error' && !stage.afterConfirming && (
        <Text
          style={styles.error}
          testID="settings-delete-account-error"
          accessible
          accessibilityRole="alert"
        >
          {stage.message}
        </Text>
      )}

      <Sheet
        visible={stage.kind === 'confirming' || stage.kind === 'deleting' || failedWhileConfirming}
        onDismiss={dismiss}
        testID="settings-delete-account-sheet"
      >
        {stage.kind === 'deleting' && (
          <View style={styles.sheetContent} testID="settings-delete-account-progress">
            <Text style={styles.body}>Deleting your account…</Text>
          </View>
        )}

        {stage.kind === 'error' && stage.afterConfirming && (
          <View style={styles.sheetContent} testID="settings-delete-account-confirm-error">
            <Text
              style={styles.error}
              testID="settings-delete-account-error"
              accessible
              accessibilityRole="alert"
            >
              {stage.message}
            </Text>
            <Button
              testID="settings-delete-account-error-close-button"
              title="Close"
              variant="secondary"
              onPress={dismiss}
            />
          </View>
        )}

        {stage.kind === 'confirming' && (
          // Bounded and scrollable, because this is the one sheet whose
          // content can outgrow the space the keyboard leaves — the
          // consequence text is a paragraph, and it grows further under
          // Dynamic Type. Being unable to read what is about to be
          // deleted, on the screen asking you to confirm it, is the
          // failure #193 is about; solving it only for the button would
          // not be solving it.
          //
          // Bounded here rather than in Sheet: Sheet has four other
          // consumers, and giving all of them a height rule to fix one
          // is a wider change than this is. Library's filter sheet
          // already carries its own maxHeight for the same reason. Half
          // the window is the largest this can be and still clear a
          // keyboard on the smallest supported device — the device pass
          // #193 asks for is what confirms it.
          //
          // keyboardShouldPersistTaps for the same reason SettingsScreen
          // uses it (#128): otherwise the first tap on Delete is
          // swallowed to dismiss the keyboard.
          <ScrollView
            style={{ maxHeight: windowHeight * 0.5 }}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            testID="settings-delete-account-confirm"
          >
            <Text style={styles.warningTitle}>Delete your account?</Text>
            <Text style={styles.body} testID="settings-delete-account-consequence">
              {describe(stage.plan.mode)}
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
              onPress={() => confirm(stage.plan)}
              disabled={typed.trim().toLowerCase() !== CONFIRMATION_PHRASE}
            />
            <Button
              testID="settings-delete-account-cancel-button"
              title="Keep my account"
              variant="secondary"
              onPress={dismiss}
            />
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    gap: spacing.sm,
  },
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
