import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';
import type { IconProps } from './icons/Icon';

// The label sits on the accent fill when selected, so an icon beside it
// has to flip too — kept as one constant so the two can't drift.
const SELECTED_FOREGROUND = '#FFFFFF';

export interface ChipProps {
  label: string;
  // The glyph component itself, not an element: the chip owns the icon's
  // colour (it flips with `selected`) and its size (16px, the design
  // handoff's "inline" step), so callers can't be the ones to set them.
  icon?: ComponentType<IconProps>;
  // Only needed when `label` has been shortened for visual space (e.g.
  // "A-Z" for a full alphabetical-sort chip) and the short form alone
  // wouldn't read clearly to a screen reader. Defaults to `label`.
  accessibilityLabel?: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function Chip({
  label,
  icon: IconGlyph,
  accessibilityLabel,
  selected = false,
  onPress,
  testID,
}: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      testID={testID}
      style={({ pressed }) => [styles.base, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={styles.content}>
        {IconGlyph ? (
          <IconGlyph color={selected ? SELECTED_FOREGROUND : colors.textPrimary} size={16} />
        ) : null}
        <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
      </View>
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
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  labelSelected: {
    color: SELECTED_FOREGROUND,
  },
});
