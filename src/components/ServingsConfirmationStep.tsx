import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SCALE_PRESETS } from '../recipes/scaling';
import { colors, spacing, typography } from '../theme/tokens';
import { Chip } from './Chip';

const DEFAULT_MULTIPLIER = 1;

export interface ServingsConfirmationItem {
  id: string;
  title: string;
}

export interface ServingsConfirmationStepProps {
  items: ServingsConfirmationItem[];
  multiplierById: Record<string, number>;
  onSelectMultiplier: (id: string, multiplier: number) => void;
  // Prefixes every testID this component renders (e.g. "add-to-this-week"),
  // so each caller keeps its own stable testIDs.
  testIDPrefix: string;
}

// ADR-0026 amendment (developer decision, 2026-08-14): every item
// gets the same scale-multiplier chips here, regardless of whether a
// numeric serving count is known for it — a servings-based stepper
// existed for that case (decision 3) but its per-item row didn't fit
// compactly next to a long title, and the two different control
// types read as inconsistent across a mixed selection. The count
// itself is still shown on Recipe Detail; it just no longer picks
// the control type here.
export function ServingsConfirmationStep({
  items,
  multiplierById,
  onSelectMultiplier,
  testIDPrefix,
}: ServingsConfirmationStepProps) {
  return (
    <ScrollView style={styles.list}>
      {items.map((item) => (
        <View key={item.id} style={styles.chipsRow} testID={`${testIDPrefix}-servings-${item.id}`}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={styles.chipGroup}>
            {SCALE_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                label={preset.label}
                selected={(multiplierById[item.id] ?? DEFAULT_MULTIPLIER) === preset.multiplier}
                onPress={() => onSelectMultiplier(item.id, preset.multiplier)}
                testID={`${testIDPrefix}-scale-preset-${item.id}-${preset.multiplier}`}
              />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    marginTop: spacing.sm,
  },
  chipsRow: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '500',
    letterSpacing: -0.16,
    color: colors.textPrimary,
    flex: 1,
  },
});
