import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme/tokens';

export interface ToggleRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
}

// An on/off setting that persists, as opposed to a Chip, which picks one
// of several filters. The switch carries the testID, since that's the
// control a test (or a user) actually flips.
export function ToggleRow({ label, value, onValueChange, testID }: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.accent }}
        accessibilityLabel={label}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
