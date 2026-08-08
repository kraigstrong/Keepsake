import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { SettingsIcon } from './icons/SettingsIcon';
import { colors, spacing, typography } from '../theme/tokens';

export interface ScreenHeaderProps {
  title: string;
}

/**
 * This Week/Library's shared title row — used instead of a native
 * header action for Settings because a lone icon up in the native
 * header, with nothing on the same row tying it to the screen's own
 * title below, read as disconnected from it (developer UX feedback).
 * Putting both in one row makes it one header block instead of two
 * stacked elements. Rendered on every branch of a screen (loading,
 * error, offline, not just the happy path) so Settings stays reachable
 * regardless of load state — the one thing this trades away versus the
 * native header is reachability while the screen is scrolled; neither
 * screen scrolls its title today, so that's not a live cost.
 */
export function ScreenHeader({ title }: ScreenHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      <Link href="/settings" accessibilityLabel="Settings" accessibilityRole="button">
        <SettingsIcon color={colors.textPrimary} size={28} />
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
});
