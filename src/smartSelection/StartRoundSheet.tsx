import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { startSelectionRound } from './api';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { colors, spacing, typography } from '../theme/tokens';

const DEFAULT_TARGET_COUNT = 4;
const MIN_TARGET_COUNT = 1;
const MAX_TARGET_COUNT = 10;

export interface StartRoundSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

/**
 * 1b, solo path only (Non-goals: no "Pick together" here — that's 1c,
 * out of scope for this slice). Same local-`visible`-owned-by-parent
 * shape as every other Sheet usage in this codebase (see
 * src/recipes/LibraryScreen.tsx's filter sheet).
 */
export function StartRoundSheet({ visible, onDismiss }: StartRoundSheetProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [targetCount, setTargetCount] = useState(DEFAULT_TARGET_COUNT);
  const [isStarting, setIsStarting] = useState(false);

  function adjustTargetCount(delta: number) {
    setTargetCount((current) =>
      Math.min(MAX_TARGET_COUNT, Math.max(MIN_TARGET_COUNT, current + delta)),
    );
  }

  async function handlePickOnMyOwn() {
    setIsStarting(true);
    try {
      const { roundId } = await startSelectionRound({ mode: 'solo', targetCount });
      onDismiss();
      router.push(`/smart-selection/${roundId}`);
    } catch (error) {
      // A 409-style conflict ("a selection round is already in progress
      // for this household") surfaces here as a plain thrown Error with
      // only a message — startSelectionRound's own error handling
      // (src/smartSelection/api.ts) doesn't parse out a structured
      // roundId even when the Edge Function's body embeds one (that's
      // metadata for a future retry-and-resume feature, not something
      // this wrapper exposes today). Simplest correct handling: surface
      // the message and let the user dismiss and retry from the entry
      // point, which re-checks getActiveSelectionRound() and will now
      // find that same round and resume it — no state to reconcile here.
      const message = error instanceof Error ? error.message : "Couldn't start a round";
      showToast(message);
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Sheet visible={visible} onDismiss={onDismiss} testID="start-round-sheet">
      <Text style={styles.heading}>Help me choose</Text>
      <Text style={styles.framing}>
        {"A batch of recipes — nothing you've made lately, nothing already on this week's plan."}
      </Text>

      <View style={styles.stepperSection}>
        <Text style={styles.stepperLabel}>Meals to find</Text>
        <View style={styles.stepperRow} testID="start-round-target-stepper">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fewer meals"
            onPress={() => adjustTargetCount(-1)}
            testID="start-round-target-decrement"
          >
            <Text style={styles.stepperButton}>−</Text>
          </Pressable>
          <Text style={styles.stepperValue}>{targetCount}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More meals"
            onPress={() => adjustTargetCount(1)}
            testID="start-round-target-increment"
          >
            <Text style={styles.stepperButton}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.caption}>Just a target — you can stop anytime.</Text>
      </View>

      <Button
        title="Pick on my own"
        onPress={handlePickOnMyOwn}
        disabled={isStarting}
        testID="start-round-solo"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  framing: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  stepperSection: {
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  stepperLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperButton: {
    ...typography.heading,
    color: colors.accent,
    paddingHorizontal: spacing.sm,
  },
  stepperValue: {
    ...typography.heading,
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: 'center',
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
