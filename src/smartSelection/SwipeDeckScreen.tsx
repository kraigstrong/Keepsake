import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  clearSelectionDecision,
  getMyDecisionsForRound,
  getSelectionRound,
  recordSelectionDecision,
  type SelectionDecisionRecord,
  type SelectionDecisionValue,
  type SelectionRound,
} from './api';
import { fetchDeckCardDetails, type DeckCardDetail } from './deckCards';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { getCachedHeroImageUrl, getHeroImageUrls } from '../recipes/heroImage';
// Type-only import of a pure, database-free server module — same
// established pattern as src/recipes/api.ts importing units types from
// server/units (see AGENTS.md's repo map: server/ is runtime-neutral,
// side-effect-free, safe to import from the client for types/pure
// functions). ReasonCode isn't re-exported by ./api.ts, which types
// SelectionRoundCandidate.reasonCodes as plain string[].
import type { ReasonCode } from '../../server/selection/scoreCandidates';
import { useSession } from '../session/SessionProvider';
import { colors, radii, spacing, typography } from '../theme/tokens';

export interface SwipeDeckScreenProps {
  roundId: string;
}

// Separate from ThisWeekScreen's own UNDO_WINDOW_MS (5000) — unrelated
// features, no shared constant.
const PASSED_UNDO_WINDOW_MS = 4000;

// Design's own ratios (HELP-ME-CHOOSE.md 1d): ±95px commits, rotate is
// dx/26. The stamp fade caps out at STAMP_FULL_OPACITY_DISTANCE, well
// before COMMIT_THRESHOLD, so it visibly reaches full strength before
// the card actually commits rather than only touching 1.0 at the exact
// release point.
const COMMIT_THRESHOLD = 95;
const STAMP_FULL_OPACITY_DISTANCE = 70;
const FLY_OUT_DISTANCE = 500;
const FLY_OUT_DURATION_MS = 220;

const DEFAULT_TARGET_COUNT = 4;

/**
 * Up to two reason codes arrive per candidate, priority order; only the
 * first is shown (1e). `never_planned` means no `planning_entries` row
 * has ever existed for this recipe — it says nothing about whether it's
 * been cooked (a recipe can be cooked via `cooking_events` without ever
 * being formally planned), so the copy must not claim "never made"
 * (Codex, PR #104).
 */
const REASON_CODE_COPY: Partial<Record<ReasonCode, string>> = {
  never_planned: "You haven't planned this one yet",
  resurfaced: "Hasn't been on the menu in a while",
  diversity: 'Something different for the mix',
  this_week_variety: "Different from what's already planned",
};

function reasonCopyFor(reasonCodes: string[]): string | undefined {
  const first = reasonCodes[0];
  return first ? REASON_CODE_COPY[first as ReasonCode] : undefined;
}

interface UndoEntry {
  recipeId: string;
  decision: SelectionDecisionValue;
}

interface PassedBannerState {
  recipeId: string;
  title: string;
}

/**
 * 1d/1e — the swipe deck. Gestures (drag-linked translate/rotate,
 * fly-out commit, spring-back) are never the only path: Undo/Not this
 * week/Yes are equal-weight controls that funnel into the same `decide`/
 * `handleUndo` functions the gesture commits into. No offline mirror
 * (ADR-0021-style always-online, matching This Week) — this screen
 * refetches from scratch on every mount, which is also what makes
 * resuming a paused round correct (getMyDecisionsForRound seeds the
 * starting position and yes count from whatever the caller already
 * decided).
 */
export function SwipeDeckScreen({ roundId }: SwipeDeckScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const reducedMotion = useReducedMotion();

  const [round, setRound] = useState<SelectionRound | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cardDetails, setCardDetails] = useState<Map<string, DeckCardDetail>>(new Map());
  const [heroUrls, setHeroUrls] = useState<Record<string, string>>({});
  const [position, setPosition] = useState(0);
  const [yesCount, setYesCount] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [passed, setPassed] = useState<PassedBannerState | null>(null);
  // Count of in-flight recordSelectionDecision calls — gates the
  // auto-navigate-to-shortlist effect below so it can't fire while the
  // very decision that reached the end of the deck (or an earlier one)
  // is still unconfirmed server-side (Codex, PR #107).
  const [pendingWriteCount, setPendingWriteCount] = useState(0);
  const passedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-recipe in-flight recordSelectionDecision promise — handleUndo
  // awaits the entry for the card it's reversing before issuing
  // clearSelectionDecision, so an out-of-order network delivery can't
  // land the clear (a no-op, since nothing's persisted yet) before the
  // delayed record upserts the vote (Codex, PR #104; AGENTS.md's
  // race-condition review priority: this repo's recurring defect class
  // is exactly a partial failure between two async calls that should be
  // ordered).
  const pendingWritesRef = useRef<Map<string, Promise<void>>>(new Map());

  const translateX = useSharedValue(0);

  const load = useCallback(async () => {
    try {
      const [roundData, decisions] = await Promise.all([
        getSelectionRound(roundId),
        userId
          ? getMyDecisionsForRound(roundId, userId)
          : Promise.resolve(new Map<string, SelectionDecisionRecord>()),
      ]);

      // Defensive sort even though get_selection_round already orders by
      // position — this screen must never depend on the RPC's ordering
      // being trustworthy on its own.
      const sortedCandidates = [...roundData.candidates].sort((a, b) => a.position - b.position);
      const details = await fetchDeckCardDetails(sortedCandidates.map((c) => c.recipeId));

      const heroPaths = [...details.values()]
        .map((d) => d.heroImagePath)
        .filter((path): path is string => path !== null);
      let urls: Record<string, string> = {};
      if (heroPaths.length > 0) {
        await getHeroImageUrls(heroPaths);
        details.forEach((detail, recipeId) => {
          if (!detail.heroImagePath) return;
          const cached = getCachedHeroImageUrl(detail.heroImagePath);
          if (cached) urls = { ...urls, [recipeId]: cached };
        });
      }

      // Resume position: the first candidate with no existing decision.
      // If every candidate is already decided, start past the end so the
      // terminal state shows immediately.
      let startIndex = sortedCandidates.findIndex((c) => !decisions.has(c.recipeId));
      if (startIndex === -1) startIndex = sortedCandidates.length;

      // Seed the undo stack from real decision history, oldest first, so
      // Undo immediately after resuming reverses the most recently
      // decided card — same as within a single live session (Codex, PR
      // #104: the design requires Undo reachable for the whole round,
      // not just what happened since the screen last mounted).
      const decidedCandidates = sortedCandidates
        .filter((c) => decisions.has(c.recipeId))
        .map((c) => ({ recipeId: c.recipeId, record: decisions.get(c.recipeId)! }))
        .sort(
          (a, b) => new Date(a.record.decidedAt).getTime() - new Date(b.record.decidedAt).getTime(),
        );
      const seededUndoStack: UndoEntry[] = decidedCandidates.map((c) => ({
        recipeId: c.recipeId,
        decision: c.record.decision,
      }));
      const seededYesCount = seededUndoStack.filter((e) => e.decision === 'yes').length;

      setRound({ ...roundData, candidates: sortedCandidates });
      setCardDetails(details);
      setHeroUrls(urls);
      setPosition(startIndex);
      setYesCount(seededYesCount);
      setUndoStack(seededUndoStack);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [roundId, userId]);

  // useFocusEffect, not a plain useEffect — matches this codebase's own
  // established idiom for a load-on-mount screen with a retry callback
  // (see ArchivedRecipesScreen.tsx/GroceryReviewScreen.tsx's identical
  // `useFocusEffect(useCallback(() => load(), [load]))` shape). Also
  // clears any pending "Passed on…" banner timeout on blur/unmount.
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        if (passedTimeoutRef.current) clearTimeout(passedTimeoutRef.current);
      };
    }, [load]),
  );

  const candidates = round?.candidates ?? [];
  const deckSize = candidates.length;
  const targetCount = round?.targetCount ?? DEFAULT_TARGET_COUNT;
  const atEndOfDeck = position >= deckSize;
  const terminal = atEndOfDeck;
  const currentCandidate = !terminal ? candidates[position] : undefined;
  const currentDetail = currentCandidate ? cardDetails.get(currentCandidate.recipeId) : undefined;
  const progressFraction = deckSize > 0 ? Math.min(position, deckSize) / deckSize : 0;

  // Exhausted deck with a pick jumps straight to the shortlist, replacing
  // (not pushing) this now-unresumable screen; a still-resumable deck
  // (the "Review N picks" bar below) pushes instead. Gated on
  // pendingWriteCount === 0 so this can't fire — and strand the user on
  // an unresumable shortlist — while the very decision that reached the
  // end of the deck is still unconfirmed server-side (Codex, PR #107):
  // a rejected write's own rollback in decide() below will have already
  // pulled position back under deckSize by the time this re-evaluates.
  useEffect(() => {
    if (atEndOfDeck && yesCount > 0 && pendingWriteCount === 0) {
      router.replace(`/smart-selection/${roundId}/shortlist`);
    }
  }, [atEndOfDeck, yesCount, pendingWriteCount, roundId, router]);

  function decide(decision: SelectionDecisionValue) {
    if (!round || !currentCandidate) return;
    const recipeId = currentCandidate.recipeId;
    const title = cardDetails.get(recipeId)?.title ?? 'that recipe';
    const decidedAtPosition = position;

    // Functional updates throughout — a later card can be decided (or
    // undone) while this write is still in flight, and a rollback below
    // must correct only this card's contribution, not clobber whatever
    // happened after it by reverting to a stale closed-over snapshot.
    setPosition((p) => p + 1);
    if (decision === 'yes') setYesCount((y) => y + 1);
    setUndoStack((stack) => [...stack, { recipeId, decision }]);

    // Per 1e, only a 'no' gets the "Passed on {title} · Undo" toast — a
    // 'yes' isn't something a user typically wants undone with the same
    // urgency, and the always-visible Undo control below covers either
    // decision type as the one general "undo whatever I just did" path.
    if (decision === 'no') {
      if (passedTimeoutRef.current) clearTimeout(passedTimeoutRef.current);
      setPassed({ recipeId, title });
      passedTimeoutRef.current = setTimeout(() => setPassed(null), PASSED_UNDO_WINDOW_MS);
    }

    // Optimistic — the UI has already advanced above — but rolled back
    // on failure, matching this app's actual established convention
    // (ThisWeekScreen.handleRemove awaits its write and restores prior
    // state on rejection; an earlier version of this comment claimed
    // the opposite and was wrong). Only position is exempted from a
    // full revert, and only when nothing has advanced past it since:
    // rewinding position unconditionally would undo real progress on
    // later cards decided while this write was still pending. If a
    // later card *has* since been decided, this card's gap is simply
    // left for a future resume to reopen (`load()`'s "first candidate
    // with no decision" already handles a gap anywhere in the deck, not
    // just a contiguous prefix).
    setPendingWriteCount((c) => c + 1);
    const writePromise = recordSelectionDecision(round.id, recipeId, decision)
      .catch(() => {
        setUndoStack((stack) => stack.filter((entry) => entry.recipeId !== recipeId));
        if (decision === 'yes') setYesCount((y) => Math.max(0, y - 1));
        setPosition((p) => (p === decidedAtPosition + 1 ? decidedAtPosition : p));
        setPassed((current) => (current?.recipeId === recipeId ? null : current));
        showToast("Couldn't save that decision — you'll need to redo it");
      })
      .finally(() => setPendingWriteCount((c) => c - 1));
    pendingWritesRef.current.set(recipeId, writePromise);
  }

  async function handleUndo() {
    if (!round || undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1]!;

    setUndoStack((stack) => stack.slice(0, -1));
    setPosition((p) => Math.max(0, p - 1));
    if (last.decision === 'yes') setYesCount((y) => Math.max(0, y - 1));
    if (passed?.recipeId === last.recipeId) {
      if (passedTimeoutRef.current) clearTimeout(passedTimeoutRef.current);
      setPassed(null);
    }

    // Wait for this card's own recordSelectionDecision to actually
    // settle before issuing the clear. Without this, an out-of-order
    // network delivery can land the clear (a no-op — nothing persisted
    // yet) before the delayed record upserts the vote, leaving the
    // server with a decision the UI just told the user was undone
    // (Codex, PR #104). A seeded (resumed) entry has no pending write
    // to wait for, so this is a no-op in that case.
    const pendingWrite = pendingWritesRef.current.get(last.recipeId);
    if (pendingWrite) await pendingWrite.catch(() => {});

    clearSelectionDecision(round.id, last.recipeId).catch(() => {
      showToast("Couldn't undo that decision");
    });
  }

  function finishAnimatedCommit(decision: SelectionDecisionValue) {
    'worklet';
    translateX.value = 0;
    runOnJS(decide)(decision);
  }

  // react-hooks/refs flags `.onEnd`'s callback because `decide` (reached
  // via runOnJS) reads `passedTimeoutRef.current`, and this whole
  // Gesture.Pan()...onEnd(...) builder chain is constructed fresh every
  // render and handed to <GestureDetector> as a prop — the same shape
  // the rule flags for a value that might read a ref during render. It
  // never actually does: gesture-handler only invokes .onEnd on a real
  // pan-end event on the UI thread, well after this render has
  // committed, via the same runOnJS bridge every Reanimated worklet
  // uses to call back into JS. The rule doesn't yet recognize
  // react-native-gesture-handler's builder API as a deferred-execution
  // event handler the way it does a plain JSX prop.
  /* eslint-disable react-hooks/refs */
  const panGesture = Gesture.Pan()
    .enabled(!terminal)
    .onUpdate((event) => {
      translateX.value = event.translationX;
    })
    .onEnd((event) => {
      const dx = event.translationX;
      if (dx > COMMIT_THRESHOLD) {
        if (reducedMotion) {
          finishAnimatedCommit('yes');
        } else {
          translateX.value = withTiming(FLY_OUT_DISTANCE, { duration: FLY_OUT_DURATION_MS }, () => {
            finishAnimatedCommit('yes');
          });
        }
      } else if (dx < -COMMIT_THRESHOLD) {
        if (reducedMotion) {
          finishAnimatedCommit('no');
        } else {
          translateX.value = withTiming(
            -FLY_OUT_DISTANCE,
            { duration: FLY_OUT_DURATION_MS },
            () => {
              finishAnimatedCommit('no');
            },
          );
        }
      } else {
        translateX.value = reducedMotion ? 0 : withSpring(0);
      }
    });
  /* eslint-enable react-hooks/refs */

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { rotate: `${translateX.value / 26}deg` }],
  }));
  const yesStampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(translateX.value / STAMP_FULL_OPACITY_DISTANCE, 0), 1),
  }));
  const noStampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(-translateX.value / STAMP_FULL_OPACITY_DISTANCE, 0), 1),
  }));

  if (loadError) {
    return (
      <View style={styles.screen} testID="swipe-deck-screen">
        <ErrorState
          title="Couldn't load the deck"
          message="Check your connection and try again."
          onRetry={load}
          testID="swipe-deck-load-error"
        />
      </View>
    );
  }

  if (round === null) {
    return (
      <View style={styles.screen} testID="swipe-deck-screen">
        <LoadingState label="Setting up your deck…" testID="swipe-deck-loading" />
      </View>
    );
  }

  const heroUrl = currentCandidate ? heroUrls[currentCandidate.recipeId] : undefined;
  const reasonCopy = currentCandidate ? reasonCopyFor(currentCandidate.reasonCodes) : undefined;

  return (
    <View style={styles.screen} testID="swipe-deck-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Pause"
          testID="swipe-deck-pause"
        >
          <Text style={styles.headerAction}>Pause</Text>
        </Pressable>
        <Text style={styles.headerPosition}>
          {Math.min(position + 1, deckSize)} of {deckSize}
        </Text>
        <Text style={styles.headerYes}>{yesCount} yes</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressFraction * 100}%` }]} />
      </View>

      <View style={styles.content}>
        {terminal ? (
          yesCount > 0 ? (
            // Mid-flight to the shortlist (the effect above fires on the
            // same render this becomes true) — a brief loading state
            // here beats a flash of stale deck copy the user is already
            // leaving.
            <LoadingState label="Finishing up…" testID="swipe-deck-advancing" />
          ) : (
            <View style={styles.terminal} testID="swipe-deck-terminal">
              <Text style={styles.terminalTitle}>No picks this round</Text>
              {/* A mistaken last 'no' must stay reversible (1d, Codex PR
                  #104) — handleUndo un-terminals correctly (position
                  drops back under deckSize, atEndOfDeck follows). */}
              <UndoControl
                onPress={handleUndo}
                disabled={undoStack.length === 0}
                testID="swipe-deck-terminal-undo"
              />
              <Button
                title="Done for now"
                onPress={() => router.back()}
                variant="secondary"
                testID="swipe-deck-done"
              />
            </View>
          )
        ) : (
          <>
            <View style={styles.cardStack} testID="swipe-deck-card-stack">
              <View style={[styles.card, styles.cardBehindTwo]} />
              <View style={[styles.card, styles.cardBehindOne]} />
              <GestureDetector gesture={panGesture}>
                <Animated.View
                  style={[styles.card, styles.cardTop, cardAnimatedStyle]}
                  testID="swipe-deck-top-card"
                >
                  {heroUrl ? (
                    <>
                      <Image
                        source={{ uri: heroUrl }}
                        style={styles.cardImage}
                        testID="swipe-deck-card-image"
                      />
                      <View style={styles.cardBody}>
                        <Text style={styles.cardTitle} numberOfLines={2}>
                          {currentDetail?.title}
                        </Text>
                        {currentDetail?.totalTimeMinutes != null && (
                          <Text style={styles.cardMeta}>{currentDetail.totalTimeMinutes} min</Text>
                        )}
                        {reasonCopy && <Text style={styles.cardReason}>{reasonCopy}</Text>}
                      </View>
                    </>
                  ) : (
                    <View style={[styles.cardBody, styles.cardBodyTypographic]}>
                      <Text style={styles.cardTitleTypographic} numberOfLines={3}>
                        {currentDetail?.title}
                      </Text>
                      {currentDetail?.totalTimeMinutes != null && (
                        <Text style={styles.cardMeta}>{currentDetail.totalTimeMinutes} min</Text>
                      )}
                      {reasonCopy && <Text style={styles.cardReason}>{reasonCopy}</Text>}
                    </View>
                  )}

                  <Animated.View
                    style={[styles.stamp, styles.stampYes, yesStampStyle]}
                    pointerEvents="none"
                  >
                    <Text style={styles.stampYesText}>YES</Text>
                  </Animated.View>
                  <Animated.View
                    style={[styles.stamp, styles.stampNo, noStampStyle]}
                    pointerEvents="none"
                  >
                    <Text style={styles.stampNoText}>NOT THIS WEEK</Text>
                  </Animated.View>
                </Animated.View>
              </GestureDetector>
            </View>

            {yesCount >= targetCount && (
              <View style={styles.reviewBar} testID="swipe-deck-review-bar">
                <Text style={styles.reviewBarText}>
                  {`You've got ${yesCount} — finish now or keep looking.`}
                </Text>
                <Pressable
                  onPress={() => router.push(`/smart-selection/${roundId}/shortlist`)}
                  accessibilityRole="button"
                  testID="swipe-deck-review-action"
                >
                  <Text style={styles.reviewBarAction}>Review {yesCount} picks</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.controlsRow}>
              <UndoControl onPress={handleUndo} disabled={undoStack.length === 0} />
              <View style={styles.decisionButtons}>
                <View style={styles.decisionButton}>
                  <Button
                    title="Not this week"
                    variant="secondary"
                    onPress={() => decide('no')}
                    testID="swipe-deck-no"
                  />
                </View>
                <View style={styles.decisionButton}>
                  <Button title="Yes" onPress={() => decide('yes')} testID="swipe-deck-yes" />
                </View>
              </View>
            </View>
          </>
        )}
      </View>

      {passed && (
        <View style={styles.passedBanner} testID="swipe-deck-passed-banner" role="alert" accessible>
          <Text style={styles.passedText} numberOfLines={1}>
            Passed on {passed.title}
          </Text>
          <Pressable
            onPress={handleUndo}
            accessibilityRole="button"
            testID="swipe-deck-passed-undo"
          >
            <Text style={styles.passedAction}>Undo</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

interface UndoControlProps {
  onPress: () => void;
  disabled: boolean;
  testID?: string;
}

/** Shared between the deck's controls row and the terminal state (1d: undo reachable throughout). */
function UndoControl({ onPress, disabled, testID = 'swipe-deck-undo' }: UndoControlProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Undo last decision"
      style={[styles.undoButton, disabled && styles.undoButtonDisabled]}
      testID={testID}
    >
      <Text style={styles.undoButtonText}>Undo</Text>
    </Pressable>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  headerAction: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
  },
  headerPosition: {
    ...typography.body,
    color: colors.textPrimary,
  },
  headerYes: {
    ...typography.body,
    color: colors.textSecondary,
  },
  progressTrack: {
    height: 3,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.border,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  cardStack: {
    flex: 1,
  },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  // 7px / 14px insets per the design's card-stack depth, decreasing
  // zIndex — these two never render real content (a legitimate
  // simplification for this slice; only the top card is interactive).
  cardBehindTwo: {
    top: 14,
    left: 14,
    right: 14,
    zIndex: 1,
  },
  cardBehindOne: {
    top: 7,
    left: 7,
    right: 7,
    zIndex: 2,
  },
  cardTop: {
    zIndex: 3,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardImage: {
    width: '100%',
    height: 300,
  },
  cardBody: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardBodyTypographic: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  cardTitleTypographic: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  cardMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  cardReason: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  stamp: {
    position: 'absolute',
    top: spacing.lg,
    borderWidth: 2,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  stampYes: {
    left: spacing.lg,
    borderColor: '#6B7F5E',
    transform: [{ rotate: '-12deg' }],
  },
  stampYesText: {
    ...typography.heading,
    color: '#6B7F5E',
  },
  stampNo: {
    right: spacing.lg,
    borderColor: colors.textPrimary,
    transform: [{ rotate: '12deg' }],
  },
  stampNoText: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  reviewBar: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  reviewBarText: {
    ...typography.body,
    color: colors.background,
  },
  reviewBarAction: {
    ...typography.body,
    fontWeight: '700',
    color: colors.background,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  undoButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  undoButtonDisabled: {
    opacity: 0.4,
  },
  undoButtonText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  decisionButtons: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  decisionButton: {
    flex: 1,
  },
  terminal: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  terminalTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  passedBanner: {
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
  passedText: {
    ...typography.body,
    color: colors.background,
    flex: 1,
  },
  passedAction: {
    ...typography.body,
    fontWeight: '700',
    color: colors.background,
  },
});
