import { Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  /** Passed straight through to the underlying Pressable's raw View touch
   * props — not part of Pressability, so they fire even when `disabled`
   * (callers using them must guard that themselves) and bypass
   * Pressability's own gesture state machine, which RN's touch-responder
   * negotiation can occasionally lose entirely (neither onPress nor
   * onPressIn ever fires) — confirmed via live device testing,
   * 2026-08-20, specifically when a sibling multiline (UITextView-backed)
   * TextInput loses focus concurrently with the touch. See
   * DoneCookingSheet's confirm button for the full diagnosis and a
   * working cancel-aware guard built on this family of events. */
  onTouchStart?: (event: GestureResponderEvent) => void;
  onTouchMove?: (event: GestureResponderEvent) => void;
  onTouchEnd?: () => void;
  onTouchCancel?: () => void;
  variant?: 'primary' | 'secondary' | 'outlineAccent';
  disabled?: boolean;
  testID?: string;
}

export function Button({
  title,
  onPress,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  variant = 'primary',
  disabled,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, variant !== 'primary' && labelVariantStyles[variant]]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Bordered rust, deliberately not filled — for a secondary action that
  // must not compete visually with a filled primary button on the same
  // screen (e.g. This Week's "Help me choose" entry point vs. Review
  // Groceries). Distinct from `secondary`, which uses the neutral
  // hairline border/surface tint used everywhere else.
  outlineAccent: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  labelSecondary: {
    color: colors.textPrimary,
  },
  labelOutlineAccent: {
    color: colors.accent,
  },
});

const variantStyles = {
  primary: styles.primary,
  secondary: styles.secondary,
  outlineAccent: styles.outlineAccent,
} as const;

const labelVariantStyles = {
  secondary: styles.labelSecondary,
  outlineAccent: styles.labelOutlineAccent,
} as const;
