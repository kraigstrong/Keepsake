import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme/tokens';
import { Button } from './Button';

export interface ErrorStateProps {
  title: string;
  message?: string;
  onRetry?: () => void;
  testID?: string;
}

export function ErrorState({ title, message, onRetry, testID }: ErrorStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      {/* accessible merges descendants into one announcement — scoped to
          just the text so the retry button below stays independently
          focusable/tappable for VoiceOver, not swallowed into the alert. */}
      <View role="alert" accessible>
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
      </View>
      {onRetry && (
        <View style={styles.action}>
          <Button title="Try again" onPress={onRetry} variant="secondary" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xs,
  },
  title: {
    ...typography.heading,
    color: colors.danger,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.md,
  },
});
