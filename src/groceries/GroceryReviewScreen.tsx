import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  GROCERY_CATEGORY_LABELS,
  GROCERY_CATEGORY_ORDER,
} from '../../server/groceries/categoryDictionary.ts';
import { fetchGroceryReview, setGroceryItemSelection, type GroceryReviewItem } from './api';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { OfflineState } from '../components/OfflineState';
import { useToast } from '../components/Toast';
import { useConnectivity } from '../connectivity/ConnectivityProvider';
import { colors, radii, spacing, typography } from '../theme/tokens';

export interface GroceryReviewScreenProps {
  planId: string;
}

/**
 * OFF-04: grocery export requires connectivity, same as This Week — no
 * local mirror here either. GRO-01/GRO-02 (grouped review,
 * include/exclude): the list itself is recomputed fresh on every load
 * (ADR-0022), so there is no separate "regenerate" action — it's always
 * current by construction.
 */
export function GroceryReviewScreen({ planId }: GroceryReviewScreenProps) {
  const { isOnline } = useConnectivity();
  const { showToast } = useToast();

  const [items, setItems] = useState<GroceryReviewItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const review = await fetchGroceryReview(planId);
      setItems(review.items);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [planId]);

  // isOnline is a real dependency, not just an exhaustive-deps
  // formality — see ThisWeekScreen.tsx's identical comment: it's what
  // makes the offline -> online transition reload the list without a
  // separate effect.
  useFocusEffect(
    useCallback(() => {
      if (isOnline) load();
    }, [isOnline, load]),
  );

  async function handleToggle(item: GroceryReviewItem) {
    if (!items) return;
    const nextIncluded = !item.included;
    const previous = items;
    setItems(
      items.map((i) => (i.itemHash === item.itemHash ? { ...i, included: nextIncluded } : i)),
    );
    try {
      await setGroceryItemSelection(planId, item.itemHash, nextIncluded);
    } catch {
      setItems(previous);
      showToast("Couldn't update that item");
    }
  }

  if (!isOnline) {
    return (
      <View style={styles.screen} testID="grocery-review-screen">
        <Text style={styles.title}>Groceries</Text>
        <View style={styles.centered}>
          <OfflineState
            message="Grocery review needs a connection to load and update your list."
            testID="grocery-review-offline"
          />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.screen} testID="grocery-review-screen">
        <Text style={styles.title}>Groceries</Text>
        <View style={styles.centered}>
          <ErrorState
            title="Couldn't load your grocery list"
            message="Check your connection and try again."
            onRetry={load}
            testID="grocery-review-load-error"
          />
        </View>
      </View>
    );
  }

  if (items === null) {
    return (
      <View style={styles.screen} testID="grocery-review-screen">
        <Text style={styles.title}>Groceries</Text>
        <LoadingState label="Building your grocery list…" testID="grocery-review-loading" />
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="grocery-review-screen">
      <Text style={styles.title}>Groceries</Text>
      <ScrollView style={styles.list} testID="grocery-review-list">
        {GROCERY_CATEGORY_ORDER.map((category) => {
          const categoryItems = items.filter((item) => item.category === category);
          if (categoryItems.length === 0) return null;
          return (
            <View key={category}>
              <Text style={styles.sectionHeader}>{GROCERY_CATEGORY_LABELS[category]}</Text>
              {categoryItems.map((item) => (
                <Pressable
                  key={item.itemHash}
                  style={styles.row}
                  onPress={() => handleToggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.included }}
                  testID={`grocery-review-item-${item.itemHash}`}
                >
                  <View style={[styles.checkbox, item.included && styles.checkboxSelected]}>
                    {item.included && <Text style={styles.checkmark}>{'✓'}</Text>}
                  </View>
                  <View style={styles.rowText}>
                    <Text
                      style={[styles.rowTitle, !item.included && styles.rowTitleExcluded]}
                      numberOfLines={2}
                    >
                      {item.amounts.join(', ')}
                    </Text>
                    {__DEV__ && (
                      <Text style={styles.debugText}>
                        {item.category} · {item.isStaple ? 'staple' : 'not staple'} ·{' '}
                        {item.itemHash}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  list: {
    flex: 1,
    marginTop: spacing.sm,
  },
  sectionHeader: {
    ...typography.caption,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 5,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '500',
    letterSpacing: -0.16,
    color: colors.textPrimary,
  },
  rowTitleExcluded: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  debugText: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: 2,
  },
});
