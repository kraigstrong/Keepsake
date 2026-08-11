import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { colors, radii, spacing, typography } from '../theme/tokens';

export interface DoneCookingSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: (note: string | null, removeFromPlan: boolean) => void;
  /** Only true when this recipe is on the household's current *confirmed*
   * plan and the device is online (ADR-0024 decision 4) — otherwise the
   * toggle isn't shown at all rather than shown disabled. */
  canRemoveFromPlan: boolean;
  isSubmitting: boolean;
}

/**
 * COOK-05/06: the richer Done Cooking confirmation, layered on top of
 * CookingModeScreen's own completion path (which this sheet's onConfirm
 * ultimately triggers) rather than replacing it. Short optional note
 * (prd.md §18's "Needed another tsp salt.") and, only when applicable,
 * the toggle to remove this recipe from This Week in the same step.
 */
export function DoneCookingSheet({
  visible,
  onDismiss,
  onConfirm,
  canRemoveFromPlan,
  isSubmitting,
}: DoneCookingSheetProps) {
  const [note, setNote] = useState('');
  const [removeFromPlan, setRemoveFromPlan] = useState(false);

  function handleConfirm() {
    onConfirm(note.trim() || null, canRemoveFromPlan && removeFromPlan);
    setNote('');
    setRemoveFromPlan(false);
  }

  return (
    <Sheet visible={visible} onDismiss={onDismiss} testID="done-cooking-sheet">
      <Text style={styles.title}>Done Cooking</Text>

      <TextInput
        testID="done-cooking-note-input"
        style={styles.noteInput}
        placeholder="Anything worth remembering next time? (optional)"
        placeholderTextColor={colors.textTertiary}
        value={note}
        onChangeText={setNote}
        multiline
      />

      {canRemoveFromPlan && (
        <Pressable
          style={styles.toggleRow}
          onPress={() => setRemoveFromPlan((previous) => !previous)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: removeFromPlan }}
          testID="done-cooking-remove-from-plan-toggle"
        >
          <View style={[styles.checkbox, removeFromPlan && styles.checkboxSelected]}>
            {removeFromPlan && <Text style={styles.checkmark}>{'✓'}</Text>}
          </View>
          <Text style={styles.toggleLabel}>Remove from This Week</Text>
        </Pressable>
      )}

      <Button
        title="Done Cooking"
        onPress={handleConfirm}
        disabled={isSubmitting}
        testID="done-cooking-confirm-button"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  noteInput: {
    ...typography.body,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  toggleLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
