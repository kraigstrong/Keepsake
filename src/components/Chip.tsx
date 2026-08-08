import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

export interface ChipProps {
  label: string;
  // Only needed when `label` has been shortened for visual space (e.g.
  // "A-Z" for a full alphabetical-sort chip) and the short form alone
  // wouldn't read clearly to a screen reader. Defaults to `label`.
  accessibilityLabel?: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function Chip({ label, accessibilityLabel, selected = false, onPress, testID }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      testID={testID}
      style={({ pressed }) => [styles.base, selected && styles.selected, pressed && styles.pressed]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  labelSelected: {
    color: '#FFFFFF',
  },
});
