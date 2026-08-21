import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  GROCERY_CATEGORY_LABELS,
  GROCERY_CATEGORY_ORDER,
} from '../../server/groceries/categoryDictionary.ts';
import {
  clearGroceryItemSelection,
  fetchGroceryReview,
  setGroceryItemSelection,
  GROCERY_REVIEW_PLAN_NOT_CONFIRMED,
  type GroceryReviewItem,
} from './api';
import { GroceryExportPanel } from './GroceryExportPanel';
import { Checkbox } from '../components/Checkbox';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { OfflineState } from '../components/OfflineState';
import { useToast } from '../components/Toast';
import { useConnectivity } from '../connectivity/ConnectivityProvider';
import { useHousehold } from '../household/HouseholdProvider';
import { colors, spacing, typography } from '../theme/tokens';

export interface GroceryReviewScreenProps {
  planId: string;
}

function GroceryRow({
  item,
  pending,
  onToggle,
}: {
  item: GroceryReviewItem;
  pending: boolean;
  onToggle: (item: GroceryReviewItem) => void;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={() => onToggle(item)}
      disabled={pending}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.included, disabled: pending }}
      testID={`grocery-review-item-${item.itemHash}`}
    >
      <Checkbox checked={item.included} />
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, !item.included && styles.rowTitleExcluded]}
          numberOfLines={2}
        >
          {item.amounts.join(', ')}
        </Text>
        {__DEV__ && (
          <Text style={styles.debugText}>
            {item.category} · {item.isStaple ? 'staple' : 'not staple'} · {item.itemHash}
          </Text>
        )}
      </View>
    </Pressable>
  );
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
  const { household, profile } = useHousehold();
  // Found via live testing, 2026-08-14: a recipe whose source listed
  // both units for the same quantity ("800g / 28oz crushed tomato")
  // only ever kept whichever the source happened to write first, with
  // no awareness of the household's own preference. Reads straight off
  // the already-loaded HouseholdProvider profile (Codex review, PR #63)
  // rather than a second fetchProfile call — that duplicate call raced
  // this screen's own initial load, so a slow/failed second fetch could
  // leave the list stuck on source units, or resolve after `load()` and
  // get clobbered by whichever grocery-review response landed last.
  const preferredUnitSystem = profile?.preferredUnitSystem ?? null;

  const [items, setItems] = useState<GroceryReviewItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notConfirmed, setNotConfirmed] = useState(false);
  // Guards against a double-tap re-triggering a second RPC for the same
  // item before the first resolves (Codex review, PR #45): with two
  // in-flight requests for one item, they can resolve out of order,
  // leaving the UI showing the newer choice while the server ends up
  // persisting the older one. Ignoring a press while that item's own
  // request is still pending removes the race instead of trying to
  // fence out-of-order responses.
  const [pendingHashes, setPendingHashes] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const review = await fetchGroceryReview(planId, preferredUnitSystem);
      setItems(review.items);
      setLoadError(false);
      setNotConfirmed(false);
    } catch (error) {
      if (error instanceof Error && error.message === GROCERY_REVIEW_PLAN_NOT_CONFIRMED) {
        setNotConfirmed(true);
      } else {
        setLoadError(true);
      }
    }
  }, [planId, preferredUnitSystem]);

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
    if (pendingHashes.has(item.itemHash)) return;
    const nextIncluded = !item.included;
    const previousIncluded = item.included;

    setPendingHashes((prev) => new Set(prev).add(item.itemHash));
    setItems((prev) =>
      prev
        ? prev.map((i) => (i.itemHash === item.itemHash ? { ...i, included: nextIncluded } : i))
        : prev,
    );

    try {
      // A toggle that lands back on the item's own computed default
      // clears the override instead of persisting a row that just
      // restates it — keeps grocery_item_selections sparse as intended
      // (ADR-0022), so a future staples-list tuning isn't masked by a
      // stale row recording today's default as a deliberate choice.
      if (nextIncluded === !item.isStaple) {
        await clearGroceryItemSelection(planId, item.itemHash);
      } else {
        await setGroceryItemSelection(planId, item.itemHash, nextIncluded);
      }
    } catch {
      // Reverts only this item, not the whole list snapshot — a
      // concurrent successful toggle on a different item must survive
      // this one's failure (Codex review, PR #45).
      setItems((prev) =>
        prev
          ? prev.map((i) =>
              i.itemHash === item.itemHash ? { ...i, included: previousIncluded } : i,
            )
          : prev,
      );
      showToast("Couldn't update that item");
    } finally {
      setPendingHashes((prev) => {
        const next = new Set(prev);
        next.delete(item.itemHash);
        return next;
      });
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

  // A stale/deep link, or a co-member reopening the plan for editing
  // while this screen is open — not a connectivity problem, so it gets
  // its own copy rather than the generic "check your connection"
  // message above (Codex review, PR #45). onRetry still just re-runs
  // load(): if the plan gets (re)confirmed while this is on screen,
  // trying again succeeds without navigating away first.
  if (notConfirmed) {
    return (
      <View style={styles.screen} testID="grocery-review-screen">
        <Text style={styles.title}>Groceries</Text>
        <View style={styles.centered}>
          <ErrorState
            title="This week's plan isn't confirmed"
            message="Go back to This Week and confirm your plan before reviewing groceries."
            onRetry={load}
            testID="grocery-review-not-confirmed"
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
          // Staples get their own section below (GRO-01/GRO-02, developer
          // device-testing feedback 2026-08-08) rather than sitting
          // unchecked-but-mixed-in throughout their real aisle category —
          // "here's what you probably already have" reads as one group,
          // not scattered rows to notice individually.
          const categoryItems = items.filter(
            (item) => item.category === category && !item.isStaple,
          );
          if (categoryItems.length === 0) return null;
          return (
            <View key={category}>
              <Text style={styles.sectionHeader}>{GROCERY_CATEGORY_LABELS[category]}</Text>
              {categoryItems.map((item) => (
                <GroceryRow
                  key={item.itemHash}
                  item={item}
                  pending={pendingHashes.has(item.itemHash)}
                  onToggle={handleToggle}
                />
              ))}
            </View>
          );
        })}
        {(() => {
          const stapleItems = items.filter((item) => item.isStaple);
          if (stapleItems.length === 0) return null;
          return (
            <View>
              <Text style={styles.sectionHeader}>Staples (probably on hand)</Text>
              {stapleItems.map((item) => (
                <GroceryRow
                  key={item.itemHash}
                  item={item}
                  pending={pendingHashes.has(item.itemHash)}
                  onToggle={handleToggle}
                />
              ))}
            </View>
          );
        })()}
      </ScrollView>
      {household && (
        <GroceryExportPanel
          planId={planId}
          householdId={household.id}
          items={items
            .filter((item) => item.included)
            .map((item) => ({ itemHash: item.itemHash, displayText: item.amounts.join(', ') }))}
        />
      )}
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
