import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  /** Passed straight through to the underlying Pressable's onTouchStart —
   * a raw View touch prop, not part of Pressability, so it fires even
   * when `disabled` (callers using it must guard that themselves). Only
   * needed by callers working around RN's touch-responder negotiation
   * occasionally losing a gesture outright, so neither onPress nor
   * onPressIn ever fires — confirmed via live device testing, 2026-08-20,
   * specifically when a sibling multiline (UITextView-backed) TextInput
   * loses focus concurrently with the touch. See DoneCookingSheet's
   * confirm button for the full diagnosis and a working guard pattern. */
  onTouchStart?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  testID?: string;
}

export function Button({
  title,
  onPress,
  onTouchStart,
  variant = 'primary',
  disabled,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      onTouchStart={onTouchStart}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, variant === 'secondary' && styles.labelSecondary]}>{title}</Text>
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
});
