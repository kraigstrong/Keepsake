import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import {
  addRecipeToThisWeek,
  confirmThisWeek,
  removeFromThisWeek,
  reopenThisWeek,
  reorderThisWeek,
  type ThisWeekEntry,
  type ThisWeekPlan,
} from './api';
import { loadThisWeekPlan, peekPrefetchedThisWeekPlan } from './prefetch';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { ImagePlaceholder } from '../components/ImagePlaceholder';
import { LoadingState } from '../components/LoadingState';
import { OfflineState } from '../components/OfflineState';
import { ScreenHeader } from '../components/ScreenHeader';
import { useToast } from '../components/Toast';
import { ChevronIcon } from '../components/icons/ChevronIcon';
import { useConnectivity } from '../connectivity/ConnectivityProvider';
import { FLAGS } from '../featureFlags/flags';
import { getCachedHeroImageUrl, getHeroImageUrls } from '../recipes/heroImage';
import { useSession } from '../session/SessionProvider';
import { getActiveSelectionRound } from '../smartSelection/api';
import { StartRoundSheet } from '../smartSelection/StartRoundSheet';
import { colors, radii, spacing, typography } from '../theme/tokens';

// How long the "Removed — Undo" banner stays up (ADR-0021: client-side
// only, no server-side tombstone). Long enough to notice and react to,
// short enough not to linger once the moment's passed.
const UNDO_WINDOW_MS = 5000;

interface RemovedEntryState {
  entry: ThisWeekEntry;
}

// ADR-0026 decision 6: display, not storage, decides servings vs.
// multiplier per recipe — same conditional RecipeDetailScreen's
// timingParts already applies to its own scaling state.
function describeServings(entry: ThisWeekEntry): string {
  if (entry.servingsCount != null) {
    return `Serves ${Math.round(entry.servingsCount * entry.multiplier)}`;
  }
  return `${Math.round(entry.multiplier * 100) / 100}×`;
}

// Reads getHeroImageUrls' own per-path cache directly (src/recipes/
// heroImage.ts) rather than threading a returned map through — used both
// as the very first render's lazy initial state (whatever
// prefetchThisWeek already warmed) and again after load()'s own
// getHeroImageUrls call, so both paths agree on one source of truth.
function heroUrlsFromEntries(entries: ThisWeekEntry[]): Record<string, string> {
  const urls: Record<string, string> = {};
  entries.forEach((entry) => {
    if (!entry.heroImagePath) return;
    const cached = getCachedHeroImageUrl(entry.heroImagePath);
    if (cached) urls[entry.id] = cached;
  });
  return urls;
}

/**
 * OFF-04 / ADR-0021: This Week is always-online, no local mirror — a
 * failed load or mutation while offline is a normal, expected outcome
 * here, not a bug. Refetches on focus and on regaining connectivity so
 * a co-member's change becomes visible without a live subscription
 * (ADR-0021: no Realtime in this app yet).
 */
export function ThisWeekScreen() {
  const router = useRouter();
  const { isOnline } = useConnectivity();
  const { showToast } = useToast();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  // Seeded from AuthenticatedRouteBoundary's prefetch (src/thisWeek/
  // prefetch.ts) when it already resolved before this screen mounted —
  // the whole point of waiting for that prefetch during StartupScreen is
  // wasted if this screen still starts from nothing and populates itself
  // a beat later. load() below still runs as normal on focus and is what
  // actually keeps this correct; this only avoids a visible empty/loading
  // first paint on the common cold-launch path.
  const [plan, setPlan] = useState<ThisWeekPlan | null>(() => peekPrefetchedThisWeekPlan(userId));
  const [heroUrls, setHeroUrls] = useState<Record<string, string>>(() =>
    heroUrlsFromEntries(peekPrefetchedThisWeekPlan(userId)?.entries ?? []),
  );
  const [loadError, setLoadError] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [removed, setRemoved] = useState<RemovedEntryState | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [startRoundSheetVisible, setStartRoundSheetVisible] = useState(false);
  const [isCheckingActiveRound, setIsCheckingActiveRound] = useState(false);
  // Closes a swiped-open row once its Remove action has been tapped —
  // Swipeable doesn't do this itself, and the row disappearing from
  // `plan.entries` right after (the optimistic update below) isn't
  // enough on its own to reset the open swipe offset.
  const swipeableRefs = useRef<Map<string, SwipeableMethods>>(new Map());

  const load = useCallback(async () => {
    try {
      const current = await loadThisWeekPlan(userId);
      setPlan(current);
      setLoadError(false);

      const heroImagePaths = current.entries
        .map((entry) => entry.heroImagePath)
        .filter((path): path is string => path !== null);
      if (heroImagePaths.length > 0) {
        // One batched call (see getHeroImageUrls) so every thumbnail that
        // resolves lands in the same setHeroUrls update instead of
        // trickling in one at a time as N individual calls each resolve.
        await getHeroImageUrls(heroImagePaths);
        setHeroUrls((prev) => ({ ...prev, ...heroUrlsFromEntries(current.entries) }));
      }
    } catch {
      setLoadError(true);
    }
  }, [userId]);

  // isOnline is a real dependency, not just an exhaustive-deps
  // formality: useFocusEffect re-runs its callback immediately whenever
  // the callback's identity changes while the screen is still focused
  // (react-navigation's own behavior, not just on a focus event), so
  // including it here is what makes the offline -> online transition
  // reload the plan without a separate effect.
  useFocusEffect(
    useCallback(() => {
      if (isOnline) load();
    }, [isOnline, load]),
  );

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  function goToAddRecipes() {
    if (!plan) return;
    router.push(`/this-week/add?planId=${plan.id}`);
  }

  // 1a's entry point: an active round (a deck already exists — ADR-0027
  // decision 1a's pending_candidates -> active transition only happens
  // once finalize_selection_round_candidates has actually written it) is
  // resumed straight into the deck, skipping the start sheet — what
  // makes leaving mid-round safe without building 1g's persistent
  // "round in progress" card (out of scope for this slice, see the work
  // item's Non-goals).
  //
  // A pending_candidates round has NO deck yet — candidate generation
  // started but never finished (the Edge Function died between creating
  // the round and finalizing it). Routing that straight to the swipe
  // screen would show an empty, permanently-terminal deck with no way
  // out, since the household's one-round-at-a-time index blocks a fresh
  // start too (Codex, PR #104). The fix is the same recovery path
  // ADR-0027 decision 1a already built for this: opening the start sheet
  // and calling startSelectionRound again adopts the stuck pending round
  // (create_selection_round resumes it for the same creator) and retries
  // candidate generation, rather than treating it as swipeable.
  //
  // ready_for_review, or no round at all, are treated the same as
  // pending here — reviewing/closing a round is the next PR's scope.
  async function handleHelpMeChoose() {
    setIsCheckingActiveRound(true);
    try {
      const activeRound = await getActiveSelectionRound();
      if (activeRound && activeRound.status === 'active') {
        router.push(`/smart-selection/${activeRound.id}`);
        return;
      }
      setStartRoundSheetVisible(true);
    } catch {
      showToast("Couldn't check for an in-progress round");
    } finally {
      setIsCheckingActiveRound(false);
    }
  }

  // Tap-based reorder, not drag-and-drop (developer decision, 2026-08-07):
  // the obvious library for this, react-native-draggable-flatlist,
  // throws at module load against this app's react-native-reanimated
  // 4.5.1 ("Your version of react-native-reanimated is too old") — it
  // was never updated for reanimated v4's restructuring around the
  // separate react-native-worklets package, so it's a real
  // incompatibility here, not just a peer-dependency-range false
  // positive. Swaps the pressed entry with its neighbor and resubmits
  // the whole order through the same reorder_planning_entries RPC a real
  // drag would have used.
  async function handleMove(index: number, direction: -1 | 1) {
    if (!plan) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= plan.entries.length) return;

    const reordered = [...plan.entries];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved!);

    const previous = plan;
    setPlan({ ...plan, entries: reordered });
    setIsMutating(true);
    try {
      await reorderThisWeek(
        plan.id,
        reordered.map((entry) => entry.id),
      );
    } catch {
      setPlan(previous);
      showToast("Couldn't reorder This Week");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleRemove(entry: ThisWeekEntry) {
    if (!plan) return;
    swipeableRefs.current.get(entry.id)?.close();
    const previous = plan;
    setPlan({ ...plan, entries: plan.entries.filter((e) => e.id !== entry.id) });

    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setRemoved({ entry });
    undoTimeoutRef.current = setTimeout(() => setRemoved(null), UNDO_WINDOW_MS);

    try {
      await removeFromThisWeek(entry.id);
    } catch {
      setPlan(previous);
      setRemoved(null);
      showToast("Couldn't remove that recipe");
    }
  }

  async function handleUndo() {
    if (!plan || !removed) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    const { entry } = removed;
    setRemoved(null);
    try {
      await addRecipeToThisWeek(plan.id, entry.recipeId, entry.multiplier);
      load();
    } catch {
      showToast("Couldn't restore that recipe");
    }
  }

  // Optimistic, same pattern as handleRemove above — confirming/
  // reopening previously awaited the RPC *then* a full load() before
  // touching local state at all, stacking two sequential network round
  // trips before the UI showed anything (developer-reported ~0.75s lag
  // on Confirm Plan). Neither RPC changes anything this screen actually
  // renders (confirm's planned_count/updated_at stamps aren't shown
  // here), so the reload was pure latency, not freshness.
  async function handleConfirm() {
    if (!plan) return;
    const previous = plan;
    setPlan({ ...plan, status: 'confirmed' });
    setIsMutating(true);
    try {
      await confirmThisWeek(plan.id);
    } catch {
      setPlan(previous);
      showToast("Couldn't confirm this week's plan");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleEditPlan() {
    if (!plan) return;
    const previous = plan;
    setPlan({ ...plan, status: 'planning' });
    setIsMutating(true);
    try {
      await reopenThisWeek(plan.id);
    } catch {
      setPlan(previous);
      showToast("Couldn't reopen this week's plan");
    } finally {
      setIsMutating(false);
    }
  }

  // Swipe-to-remove (Gmail-style), not a persistent X — the X sat right
  // next to the up/down reorder buttons and was too easy to hit by
  // accident while reordering. gesture-handler v3 dropped the classic
  // Animated-driven Swipeable, so this is ReanimatedSwipeable now; unlike
  // react-native-draggable-flatlist (ADR-0021), it doesn't hit the
  // react-native-reanimated incompatibility — confirmed by this file's
  // test suite passing against reanimated 4.5.3.
  function renderPlanningItem(item: ThisWeekEntry, index: number, count: number) {
    return (
      <Swipeable
        key={item.id}
        ref={(ref) => {
          if (ref) swipeableRefs.current.set(item.id, ref);
          else swipeableRefs.current.delete(item.id);
        }}
        overshootRight={false}
        renderRightActions={() => (
          <Pressable
            onPress={() => handleRemove(item)}
            style={styles.swipeRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.title} from This Week`}
            testID={`this-week-entry-remove-${item.id}`}
          >
            <Text style={styles.swipeRemoveText}>Remove</Text>
          </Pressable>
        )}
      >
        <View style={styles.row} testID={`this-week-entry-${item.id}`}>
          <Thumbnail url={heroUrls[item.id]} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.rowSubtitle}>{describeServings(item)}</Text>
          </View>
          <View style={styles.moveButtons}>
            <Pressable
              onPress={() => handleMove(index, -1)}
              disabled={index === 0 || isMutating}
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} up`}
              hitSlop={8}
              testID={`this-week-entry-move-up-${item.id}`}
            >
              <Text style={[styles.moveButton, index === 0 && styles.moveButtonDisabled]}>
                {'▲'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleMove(index, 1)}
              disabled={index === count - 1 || isMutating}
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} down`}
              hitSlop={8}
              testID={`this-week-entry-move-down-${item.id}`}
            >
              <Text style={[styles.moveButton, index === count - 1 && styles.moveButtonDisabled]}>
                {'▼'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Swipeable>
    );
  }

  function renderConfirmedItem(item: ThisWeekEntry) {
    return (
      <Pressable
        key={item.id}
        style={styles.row}
        onPress={() => router.push(`/recipe/${item.recipeId}`)}
        accessibilityRole="button"
        testID={`this-week-entry-${item.id}`}
      >
        <Thumbnail url={heroUrls[item.id]} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.rowSubtitle}>{describeServings(item)}</Text>
        </View>
        <ChevronIcon color={colors.textTertiary} size={20} />
      </Pressable>
    );
  }

  if (!isOnline) {
    return (
      <View style={styles.screen} testID="this-week-screen">
        <ScreenHeader title="This Week" />
        <View style={styles.centered}>
          <OfflineState
            message="This Week needs a connection to load and update your plan."
            testID="this-week-offline"
          />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.screen} testID="this-week-screen">
        <ScreenHeader title="This Week" />
        <View style={styles.centered}>
          <ErrorState
            title="Couldn't load this week's plan"
            message="Check your connection and try again."
            onRetry={load}
            testID="this-week-load-error"
          />
        </View>
      </View>
    );
  }

  if (plan === null) {
    return (
      <View style={styles.screen} testID="this-week-screen">
        <ScreenHeader title="This Week" />
        <LoadingState label="Loading this week's plan…" testID="this-week-loading" />
      </View>
    );
  }

  const isConfirmed = plan.status === 'confirmed';

  return (
    <View style={styles.screen} testID="this-week-screen">
      <ScreenHeader title="This Week" />

      {/* One row, both real Buttons, each flex:1 — previously they hugged
          their own label width with only an 8px gap, so they clumped on
          the left with dead space on the right (developer UX feedback:
          "smushed"). Add recipes stays the primary/rust button matching
          the empty state below — Confirm Plan finishes the plan, but
          rust already means "keep building the plan" from the empty
          state, and flipping that meaning once the plan has entries is
          what read as inconsistent, not a case for Confirm needing the
          louder color.

          Review Groceries sits in the *second* (right-hand) slot here,
          matching Confirm Plan's position in the row above — developer
          UX feedback, 2026-08-08: confirming and then moving on to
          groceries should be a same-spot "tap tap", not a reach across
          the row because the forward action swapped sides once the plan
          confirmed. Edit Plan takes the first slot instead. */}
      {isConfirmed ? (
        <View style={styles.actionsRow}>
          <View style={styles.actionsRowItem}>
            <Button
              title="Edit Plan"
              onPress={handleEditPlan}
              disabled={isMutating}
              variant="secondary"
              testID="this-week-edit-plan"
            />
          </View>
          <View style={styles.actionsRowItem}>
            <Button
              title="Review Groceries"
              onPress={() => router.push(`/groceries/${plan.id}`)}
              testID="this-week-review-groceries"
            />
          </View>
        </View>
      ) : (
        plan.entries.length > 0 && (
          <View style={styles.actionsRow}>
            <View style={styles.actionsRowItem}>
              <Button title="Add recipes" onPress={goToAddRecipes} testID="this-week-add-recipes" />
            </View>
            <View style={styles.actionsRowItem}>
              <Button
                title="Confirm Plan"
                onPress={handleConfirm}
                disabled={isMutating}
                variant="secondary"
                testID="this-week-confirm-plan"
              />
            </View>
          </View>
        )
      )}

      <View style={styles.content}>
        {plan.entries.length === 0 ? (
          <EmptyState
            title="Nothing planned yet"
            message="Add a recipe to start planning this week's meals."
            actionLabel="Add recipes"
            onAction={goToAddRecipes}
            testID="this-week-placeholder"
          />
        ) : isConfirmed ? (
          <ScrollView testID="this-week-confirmed-list">
            {plan.entries.map((entry) => renderConfirmedItem(entry))}
          </ScrollView>
        ) : (
          <ScrollView testID="this-week-planning-list">
            {plan.entries.map((item, index) =>
              renderPlanningItem(item, index, plan.entries.length),
            )}
          </ScrollView>
        )}
      </View>

      {FLAGS.smartMealSelection && (
        <View style={styles.helpMeChooseSection}>
          <Button
            title="Help me choose"
            variant="outlineAccent"
            onPress={handleHelpMeChoose}
            disabled={isCheckingActiveRound}
            testID="this-week-help-me-choose"
          />
          <Text style={styles.helpMeChooseCaption}>
            {"A quick swipe-through to help pick this week's meals."}
          </Text>
        </View>
      )}

      {removed && (
        <View style={styles.undoBanner} testID="this-week-undo-banner" role="alert" accessible>
          <Text style={styles.undoText} numberOfLines={1}>
            Removed {removed.entry.title}
          </Text>
          <Pressable onPress={handleUndo} accessibilityRole="button" testID="this-week-undo-button">
            <Text style={styles.undoAction}>Undo</Text>
          </Pressable>
        </View>
      )}

      {FLAGS.smartMealSelection && (
        <StartRoundSheet
          visible={startRoundSheetVisible}
          onDismiss={() => setStartRoundSheetVisible(false)}
        />
      )}
    </View>
  );
}

function Thumbnail({ url }: { url: string | undefined }) {
  if (!url) {
    return <ImagePlaceholder size={58} testID="this-week-thumbnail-placeholder" />;
  }
  return <Image source={{ uri: url }} style={styles.thumbnail} testID="this-week-thumbnail" />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  actionsRowItem: {
    flex: 1,
  },
  content: {
    flex: 1,
    marginTop: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 5,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  thumbnail: {
    width: 58,
    height: 58,
    borderRadius: radii.md,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '600',
    letterSpacing: -0.16,
    color: colors.textPrimary,
  },
  rowSubtitle: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: 2,
  },
  swipeRemove: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  swipeRemoveText: {
    ...typography.body,
    fontWeight: '600',
    color: '#FFFFFF',
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
  helpMeChooseSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  helpMeChooseCaption: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  undoBanner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  undoText: {
    ...typography.body,
    color: colors.background,
    flex: 1,
  },
  undoAction: {
    ...typography.body,
    fontWeight: '700',
    color: colors.background,
  },
});
