import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  applySelectionRound,
  closeSelectionRound,
  getMyDecisionsForRound,
  getSelectionRound,
} from './api';
import { fetchDeckCardDetails } from './deckCards';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { ServingsConfirmationStep } from '../components/ServingsConfirmationStep';
import { useToast } from '../components/Toast';
import { useSession } from '../session/SessionProvider';
import { fetchCurrentWeeklyPlan } from '../thisWeek/api';
import { colors, spacing, typography } from '../theme/tokens';

// ADR-0018-style: presets are screen-local and reset every visit, same
// default AddToThisWeekScreen uses for the same component.
const DEFAULT_MULTIPLIER = 1;

export interface ReviewScreenProps {
  roundId: string;
  /** Ordered, checked-only ids handed forward from the shortlist (1i). */
  recipeIds: string[];
}

interface ReviewItem {
  id: string;
  title: string;
}

/**
 * 1k — review before This Week. Reuses ServingsConfirmationStep exactly
 * as AddToThisWeekScreen does, per the design's explicit "reuses the
 * existing confirmation pattern" note.
 *
 * Add-to-This-Week re-fetches the round's live status right before
 * closing it, rather than trusting whatever status this screen loaded
 * with: a retry after applySelectionRound fails must not call
 * close_selection_round a second time, since it requires 'active'
 * (ADR-0027 decision 3) — and a first successful close already moved
 * the round to 'ready_for_review' server-side, so the live re-check
 * alone is enough to make a retry skip it. No local "did we already
 * close" flag needed on top of that.
 */
export function ReviewScreen({ roundId, recipeIds }: ReviewScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [items, setItems] = useState<ReviewItem[] | null>(null);
  // Route-param ids re-derived against the caller's actual 'yes'
  // decisions — null until loaded, distinct from an empty array (a
  // route reached with no valid picks at all, e.g. a malformed deep
  // link, a stale/foreign id, or nothing decided yet). Codex, PR #106:
  // recipeIds is untrusted route input, and apply_selection_round only
  // checks that an id was ever a *candidate* of this round, not that
  // the caller actually swiped yes on it — this re-derivation is the
  // check apply itself doesn't make.
  const [validRecipeIds, setValidRecipeIds] = useState<string[] | null>(null);
  const [weeklyPlanId, setWeeklyPlanId] = useState<string | null>(null);
  const [multiplierById, setMultiplierById] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [plan, decisions] = await Promise.all([
        fetchCurrentWeeklyPlan(),
        userId ? getMyDecisionsForRound(roundId, userId) : Promise.resolve(new Map()),
      ]);
      const validIds = recipeIds.filter((id) => decisions.get(id)?.decision === 'yes');
      const details = await fetchDeckCardDetails(validIds);

      setWeeklyPlanId(plan.id);
      setValidRecipeIds(validIds);
      setItems(validIds.map((id) => ({ id, title: details.get(id)?.title ?? '' })));
      setMultiplierById(Object.fromEntries(validIds.map((id) => [id, DEFAULT_MULTIPLIER])));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    // recipeIds is a route-param snapshot, stable for this screen's whole
    // lifetime (the review route memoizes it) — not a real reactive dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, userId]);

  // useFocusEffect, not a plain useEffect — same idiom as SwipeDeckScreen/
  // ShortlistScreen's own load-on-mount-with-retry screens, and it also
  // sidesteps the set-state-in-effect lint rule that a bare useEffect
  // calling an async setState-ing function trips.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleSubmit() {
    if (!weeklyPlanId || !validRecipeIds || validRecipeIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const round = await getSelectionRound(roundId);
      if (round.status === 'active') {
        await closeSelectionRound(roundId);
      }
      await applySelectionRound(
        roundId,
        weeklyPlanId,
        validRecipeIds.map((id) => ({
          recipeId: id,
          multiplier: multiplierById[id] ?? DEFAULT_MULTIPLIER,
        })),
      );
      showToast(
        validRecipeIds.length === 1
          ? 'Added 1 to This Week'
          : `Added ${validRecipeIds.length} to This Week`,
      );
      // Pops the whole smart-selection stack (deck/shortlist/review) back
      // to This Week in one step, rather than a plain back() that would
      // just land on the shortlist screen for an already-applied round.
      router.dismissTo('/');
    } catch {
      showToast("Couldn't add those recipes");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <View style={styles.screen} testID="review-screen">
        <ErrorState
          title="Couldn't load your picks"
          message="Check your connection and try again."
          onRetry={load}
          testID="review-load-error"
        />
      </View>
    );
  }

  if (items === null || weeklyPlanId === null || validRecipeIds === null) {
    return (
      <View style={styles.screen} testID="review-screen">
        <LoadingState label="Loading your picks…" testID="review-loading" />
      </View>
    );
  }

  // Nothing survived re-deriving against actual 'yes' decisions — a
  // malformed/stale route param, not a real state to offer the
  // destructive apply action against (Codex, PR #106).
  if (validRecipeIds.length === 0) {
    return (
      <View style={styles.screen} testID="review-screen">
        <View style={styles.emptyState} testID="review-empty">
          <Text style={styles.emptyStateTitle}>Nothing to review</Text>
          <Text style={styles.emptyStateMessage}>
            Go back to the shortlist and pick some recipes first.
          </Text>
          <Button title="Back" onPress={() => router.back()} testID="review-empty-back" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="review-screen">
      {/* headerShown: false (app/smart-selection/[roundId]/review.tsx) —
          same reasoning as AddToThisWeekScreen's own header. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="review-back"
        >
          <Text style={styles.headerAction}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Review</Text>
        <View style={styles.headerActionSpacer} />
      </View>

      <ServingsConfirmationStep
        items={items}
        multiplierById={multiplierById}
        onSelectMultiplier={(id, multiplier) =>
          setMultiplierById((prev) => ({ ...prev, [id]: multiplier }))
        }
        testIDPrefix="review"
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button
          title={`Add ${validRecipeIds.length} to This Week`}
          onPress={handleSubmit}
          disabled={isSubmitting}
          testID="review-submit"
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  headerAction: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
  },
  headerActionSpacer: {
    minWidth: 50,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  footer: {
    padding: spacing.lg,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyStateTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  emptyStateMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
