import { StyleSheet, Text, View } from 'react-native';

import type { SelectionRound } from './api';
import { groupRoundCardCopy } from './groupRound';
import { Button } from '../components/Button';
import { colors, radii, spacing, typography } from '../theme/tokens';

export interface GroupRoundCardProps {
  round: SelectionRound;
  userId: string | null;
  onOpen: (path: string) => void;
}

/** 1g — This Week's "Round in progress" card for a group round. */
export function GroupRoundCard({ round, userId, onOpen }: GroupRoundCardProps) {
  const copy = groupRoundCardCopy(round, userId);
  if (!copy) return null;

  return (
    <View style={styles.card} testID="group-round-card">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.detail} testID="group-round-card-detail">
        {copy.detail}
      </Text>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            title={copy.primary.label}
            onPress={() => onOpen(copy.primary.path)}
            testID="group-round-card-primary"
          />
        </View>
        {copy.secondary && (
          <View style={styles.action}>
            <Button
              title={copy.secondary.label}
              variant="secondary"
              onPress={() => onOpen(copy.secondary!.path)}
              testID="group-round-card-secondary"
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
