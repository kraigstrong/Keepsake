import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMyDecisionsForRound, getSelectionRound, type SelectionRoundStatus } from './api';
import { fetchDeckCardDetails } from './deckCards';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useSession } from '../session/SessionProvider';
import { colors, spacing, typography } from '../theme/tokens';

export interface ShortlistScreenProps {
  roundId: string;
}

interface ShortlistItem {
  recipeId: string;
  title: string;
  included: boolean;
}

/**
 * 1i — the solo shortlist. All of the caller's own 'yes' decisions,
 * position-ordered, each with an include checkbox (default on, nothing
 * preselected for removal) and up/down reorder. Reorder is purely local
 * state (ThisWeekScreen.handleMove's swap-with-neighbor shape) — nothing
 * backs shortlist order server-side, it's just the order Continue hands
 * to the review screen. Round stays 'active' the whole time this screen
 * is up; only Review's CTA (1k) ever closes it.
 */
export function ShortlistScreen({ roundId }: ShortlistScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [items, setItems] = useState<ShortlistItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deckSize, setDeckSize] = useState(0);
  const [decidedCount, setDecidedCount] = useState(0);
  const [roundStatus, setRoundStatus] = useState<SelectionRoundStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const [round, decisions] = await Promise.all([
        getSelectionRound(roundId),
        userId ? getMyDecisionsForRound(roundId, userId) : Promise.resolve(new Map()),
      ]);

      const sortedCandidates = [...round.candidates].sort((a, b) => a.position - b.position);
      const yesCandidates = sortedCandidates.filter(
        (c) => decisions.get(c.recipeId)?.decision === 'yes',
      );
      const details = await fetchDeckCardDetails(yesCandidates.map((c) => c.recipeId));

      setDeckSize(sortedCandidates.length);
      setDecidedCount(decisions.size);
      setRoundStatus(round.status);
      setItems(
        yesCandidates.map((c) => ({
          recipeId: c.recipeId,
          title: details.get(c.recipeId)?.title ?? '',
          included: true,
        })),
      );
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [roundId, userId]);

  // useFocusEffect, not a plain useEffect — matches SwipeDeckScreen's own
  // idiom: returning here via "Keep browsing" and swiping more cards
  // must reflect the new decisions on the next visit, not a stale
  // first-load snapshot.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function toggleIncluded(recipeId: string) {
    setItems((prev) =>
      (prev ?? []).map((item) =>
        item.recipeId === recipeId ? { ...item, included: !item.included } : item,
      ),
    );
  }

  // Same swap-with-neighbor shape as ThisWeekScreen.handleMove, minus the
  // RPC round-trip — nothing server-side backs shortlist order.
  function handleMove(index: number, direction: -1 | 1) {
    setItems((prev) => {
      if (!prev) return prev;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const reordered = [...prev];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(targetIndex, 0, moved!);
      return reordered;
    });
  }

  function handleKeepBrowsing() {
    router.back();
  }

  function handleContinue() {
    const includedIds = (items ?? []).filter((item) => item.included).map((item) => item.recipeId);
    // Serialized route param (comma-joined UUIDs) — no existing precedent
    // in this codebase for passing structured data between routes, and a
    // plain ordered id list doesn't need one.
    router.push(`/smart-selection/${roundId}/review?recipeIds=${includedIds.join(',')}`);
  }

  if (loadError) {
    return (
      <View style={styles.screen} testID="shortlist-screen">
        <ErrorState
          title="Couldn't load your shortlist"
          message="Check your connection and try again."
          onRetry={load}
          testID="shortlist-load-error"
        />
      </View>
    );
  }

  if (items === null) {
    return (
      <View style={styles.screen} testID="shortlist-screen">
        <LoadingState label="Loading your shortlist…" testID="shortlist-loading" />
      </View>
    );
  }

  const includedCount = items.filter((item) => item.included).length;
  const remainingCount = deckSize - decidedCount;
  // Once the round has left 'active' (Review's close-then-apply already
  // ran, or is resumed after apply failed — Codex, PR #106), swiping
  // more is impossible: record_selection_decision requires 'active'.
  // Offering "keep browsing" into a deck that will silently reject every
  // decision write would just be a second dead end.
  const canKeepBrowsing = remainingCount > 0 && roundStatus === 'active';

  return (
    <View style={styles.screen} testID="shortlist-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Shortlist</Text>
      </View>

      <ScrollView style={styles.list} testID="shortlist-list">
        {items.map((item, index) => (
          <Pressable
            key={item.recipeId}
            style={[styles.row, !item.included && styles.rowExcluded]}
            onPress={() => toggleIncluded(item.recipeId)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.included }}
            testID={`shortlist-item-${item.recipeId}`}
          >
            <Checkbox checked={item.included} />
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={styles.moveButtons}>
              <Pressable
                onPress={() => handleMove(index, -1)}
                disabled={index === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.title} up`}
                hitSlop={8}
                testID={`shortlist-item-move-up-${item.recipeId}`}
              >
                <Text style={[styles.moveButton, index === 0 && styles.moveButtonDisabled]}>
                  {'▲'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleMove(index, 1)}
                disabled={index === items.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.title} down`}
                hitSlop={8}
                testID={`shortlist-item-move-down-${item.recipeId}`}
              >
                <Text
                  style={[
                    styles.moveButton,
                    index === items.length - 1 && styles.moveButtonDisabled,
                  ]}
                >
                  {'▼'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {canKeepBrowsing && (
          <Pressable
            onPress={handleKeepBrowsing}
            accessibilityRole="button"
            testID="shortlist-keep-browsing"
          >
            <Text style={styles.keepBrowsingText}>
              Keep browsing the remaining {remainingCount}
            </Text>
          </Pressable>
        )}
        <Button
          title={`Continue with ${includedCount}`}
          onPress={handleContinue}
          disabled={includedCount === 0}
          testID="shortlist-continue"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowExcluded: {
    opacity: 0.55,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '500',
    letterSpacing: -0.16,
    color: colors.textPrimary,
    flex: 1,
  },
  moveButtons: {
    gap: 2,
  },
  moveButton: {
    fontSize: 13,
    color: colors.textPrimary,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  moveButtonDisabled: {
    color: colors.textTertiary,
    opacity: 0.4,
  },
  footer: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  keepBrowsingText: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'center',
  },
});
