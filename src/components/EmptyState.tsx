import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme/tokens';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Rendered under the primary action, as a lower-emphasis alternative. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Disables the primary action only — the secondary stays usable. */
  actionDisabled?: boolean;
  /** Shown below both actions. For an inline failure, not validation. */
  errorMessage?: string;
  testID?: string;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  actionDisabled,
  errorMessage,
  testID,
}: EmptyStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && (
        <View style={styles.action}>
          <Button
            title={actionLabel}
            onPress={onAction}
            disabled={actionDisabled}
            testID={testID ? `${testID}-action` : undefined}
          />
        </View>
      )}
      {secondaryActionLabel && onSecondaryAction && (
        <View style={styles.secondaryAction}>
          <Button
            title={secondaryActionLabel}
            onPress={onSecondaryAction}
            variant="secondary"
            testID={testID ? `${testID}-secondary-action` : undefined}
          />
        </View>
      )}
      {errorMessage && (
        <Text style={styles.error} testID={testID ? `${testID}-error` : undefined}>
          {errorMessage}
        </Text>
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
    color: colors.textPrimary,
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
  secondaryAction: {
    marginTop: spacing.sm,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
