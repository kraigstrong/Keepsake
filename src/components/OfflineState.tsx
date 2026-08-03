import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

export interface OfflineStateProps {
  message?: string;
  testID?: string;
}

// A non-blocking banner, not a full-screen state — browsing, searching,
// and cooking all work offline (prd.md §22); only imports/editing/
// planning/grocery export need a connection, so being offline is
// informational here, not an error.
export function OfflineState({
  message = "You're offline. Some features need a connection.",
  testID,
}: OfflineStateProps) {
  return (
    <View style={styles.container} testID={testID} role="status" accessible>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
