import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type GestureResponderEvent } from 'react-native';

import { COOKING_NOTE_MAX_LENGTH } from './api';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Sheet } from '../components/Sheet';
import { colors, radii, spacing, typography } from '../theme/tokens';

// How far a touch can drift from its start before the confirm button's
// touch-tracking guard (see handleConfirmTouchMove) treats it as a
// drag-away cancel rather than a tap. Generous relative to normal finger
// jitter during a stationary tap, tight enough to still catch an
// intentional drag off the button.
const CONFIRM_CANCEL_DISTANCE = 24;

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
  // Defaults checked when shown at all — canRemoveFromPlan already means
  // this recipe is on the current confirmed plan, so "I just cooked
  // this, take it off the list" is the common case, not something to
  // opt into on every completion (developer feedback: first walkthrough
  // found the unchecked default surprising). Still a real toggle, not a
  // forced action — pressing it once before confirming opts back out.
  const [removeFromPlan, setRemoveFromPlan] = useState(canRemoveFromPlan);
  // This sheet is mounted once and just toggles `visible` (CookingModeScreen
  // never remounts it), while canRemoveFromPlan only resolves to its real
  // value after an async plan fetch — a plain useState(canRemoveFromPlan)
  // initializer would freeze on whatever it was at first mount. Reset the
  // default on each open instead, same "adjust state during render on a
  // prop change" pattern RecipeDetailScreen uses for its own per-recipe
  // reset, not a useEffect.
  const [lastVisible, setLastVisible] = useState(visible);
  // userToggled tracks whether the toggle should still be treated as
  // "untouched" — both blocks below only apply a default while this is
  // false, so neither one clobbers a choice the user already made.
  const [userToggled, setUserToggled] = useState(false);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      setRemoveFromPlan(canRemoveFromPlan);
      setUserToggled(false);
    }
  }
  // Codex review, PR #50: the block above only fires on visible's own
  // false->true edge. If the sheet was already open when the plan
  // lookup was still pending (canRemoveFromPlan false at that point),
  // and it resolves *while* the sheet stays open, canRemoveFromPlan
  // flips false->true without visible ever changing — this block covers
  // that case, still only when the user hasn't already touched it.
  const [lastCanRemoveFromPlan, setLastCanRemoveFromPlan] = useState(canRemoveFromPlan);
  if (canRemoveFromPlan !== lastCanRemoveFromPlan) {
    setLastCanRemoveFromPlan(canRemoveFromPlan);
    if (visible && canRemoveFromPlan && !userToggled) {
      setRemoveFromPlan(true);
    }
  }

  // Confirm button uses raw touch events (see ButtonProps.onTouchStart
  // for the full diagnosis) instead of onPress/onPressIn, which RN can
  // lose entirely for this specific gesture. hasFiredConfirmRef makes it
  // safe to also keep onPress wired (needed for VoiceOver/TalkBack) —
  // both share one once-per-open handler. touchOriginRef/touchCancelledRef
  // defer the actual confirm to touch-end and cancel on a large enough
  // move or a native touch-cancel (Codex review, PR #86), so a
  // dragged-away or interrupted touch doesn't record a false completion
  // — the drag-to-cancel behavior a normal Pressable gives for free, that
  // bypassing Pressability here would otherwise lose.
  const hasFiredConfirmRef = useRef(false);
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null);
  const touchCancelledRef = useRef(false);
  useEffect(() => {
    if (visible) hasFiredConfirmRef.current = false;
  }, [visible]);

  function handleConfirm() {
    // onTouchEnd bypasses Pressable's own `disabled` gating (it's a raw
    // View prop, not part of Pressability) — isSubmitting must be
    // checked here explicitly rather than relying on the Button's
    // disabled prop alone.
    if (isSubmitting || hasFiredConfirmRef.current) return;
    hasFiredConfirmRef.current = true;
    onConfirm(note.trim() || null, canRemoveFromPlan && removeFromPlan);
    setNote('');
  }

  function handleConfirmTouchStart(event: GestureResponderEvent) {
    touchOriginRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    touchCancelledRef.current = false;
  }

  function handleConfirmTouchMove(event: GestureResponderEvent) {
    const origin = touchOriginRef.current;
    if (!origin) return;
    const dx = event.nativeEvent.pageX - origin.x;
    const dy = event.nativeEvent.pageY - origin.y;
    if (Math.hypot(dx, dy) > CONFIRM_CANCEL_DISTANCE) {
      touchCancelledRef.current = true;
    }
  }

  function handleConfirmTouchEnd() {
    if (!touchCancelledRef.current) handleConfirm();
  }

  function handleConfirmTouchCancel() {
    touchCancelledRef.current = true;
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
        maxLength={COOKING_NOTE_MAX_LENGTH}
        multiline
      />

      {canRemoveFromPlan && (
        <Pressable
          style={styles.toggleRow}
          onPress={() => {
            setUserToggled(true);
            setRemoveFromPlan((previous) => !previous);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: removeFromPlan }}
          testID="done-cooking-remove-from-plan-toggle"
        >
          <Checkbox checked={removeFromPlan} />
          <Text style={styles.toggleLabel}>Remove from This Week</Text>
        </Pressable>
      )}

      <Button
        title="Done Cooking"
        onPress={handleConfirm}
        onTouchStart={handleConfirmTouchStart}
        onTouchMove={handleConfirmTouchMove}
        onTouchEnd={handleConfirmTouchEnd}
        onTouchCancel={handleConfirmTouchCancel}
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
  toggleLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
