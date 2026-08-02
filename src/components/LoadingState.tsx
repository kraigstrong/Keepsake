import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme/tokens';

export interface LoadingStateProps {
  label?: string;
  testID?: string;
}

export function LoadingState({ label, testID }: LoadingStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <ActivityIndicator color={colors.accent} role="progressbar" accessible />
      {label && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  label: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
