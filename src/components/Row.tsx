import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme/tokens';

export interface RowProps {
  title: string;
  onPress?: () => void;
  testID?: string;
}

// Recipe rows are "title only, no metadata clutter" (prd.md §14) — this
// primitive matches that scope rather than growing subtitle/accessory
// slots nothing currently needs.
export function Row({ title, onPress, testID }: RowProps) {
  const content = (
    <View style={styles.container}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  title: {
    ...typography.body,
    // Row titles read slightly heavier than paragraph body text in this
    // direction (16px/500 vs body's 400) — a local override rather than
    // its own token since nothing else needs this exact weight yet.
    fontWeight: '500',
    letterSpacing: -0.16,
    color: colors.textPrimary,
  },
});
