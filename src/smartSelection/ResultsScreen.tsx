import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cancelSelectionRound,
  getSelectionRound,
  getSelectionRoundResults,
  type SelectionRound,
} from './api';
import { fetchDeckCardDetails } from './deckCards';
import {
  resultSections,
  resultsHeadline,
  resultsIntro,
  type ResultRow,
  type ResultSections,
} from './groupResults';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { trackEvent } from '../observability';
import { useSession } from '../session/SessionProvider';
import { colors, spacing, typography } from '../theme/tokens';

export interface ResultsScreenProps {
  roundId: string;
}

interface Loaded {
  round: SelectionRound;
  sections: ResultSections;
  completedCount: number;
}

const SECTION_TITLES: Record<keyof ResultSections, string> = {
  unanimous: 'Everyone wants this',
  majority: 'Most of you',
  mixed: 'Mixed interest',
};

/**
 * 1j/1l — a closed group round's matches, grouped by how much people
 * agreed. Only unanimous picks start ticked. Anyone in the household can
 * take the picks on to review and add them to This Week.
 */
export function ResultsScreen({ roundId }: ResultsScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showMixed, setShowMixed] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  // A load can land after the user has left; `replace` would then act on
  // whatever screen is on top instead.
  const focusedRef = useRef(false);
  // Ticks start from the defaults once; coming back from review keeps any
  // the user changed. Results are reported once per visit to a round.
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      let round = await getSelectionRound(roundId);
      if (!focusedRef.current) return;
      if (round.status === 'active') {
        router.replace(`/smart-selection/${roundId}/waiting`);
        return;
      }
      if (round.status === 'cancelled' || round.status === 'pending_candidates') {
        if (round.status === 'cancelled') showToast('That round was set aside');
        router.dismissTo('/');
        return;
      }
      let results = await getSelectionRoundResults(roundId);
      // Added by someone between the two reads: refetch the round so the
      // screen shows the read-only added state, not stale controls.
      if (results.status !== round.status) {
        round = await getSelectionRound(roundId);
        results = await getSelectionRoundResults(roundId);
      }
      const chosenIds = results.candidates.filter((c) => c.yesCount > 0).map((c) => c.recipeId);
      const details = await fetchDeckCardDetails(chosenIds);
      const titles = new Map([...details].map(([id, detail]) => [id, detail.title]));
      const sections = resultSections(results, titles, userId);

      setLoaded({ round, sections, completedCount: results.completedParticipantCount });
      setLoadError(false);
      if (initializedRef.current) return;
      initializedRef.current = true;
      setChecked(
        new Set(
          [...sections.unanimous, ...sections.majority, ...sections.mixed]
            .filter((row) => row.checkedByDefault)
            .map((row) => row.recipeId),
        ),
      );
      trackEvent('selection_results_viewed', {
        unanimous: sections.unanimous.length,
        majority: sections.majority.length,
        mixed: sections.mixed.length,
      });
      if (sections.unanimous.length + sections.majority.length === 0) {
        trackEvent('selection_no_match');
      }
    } catch {
      setLoadError(true);
    }
  }, [roundId, router, showToast, userId]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void load();
      return () => {
        focusedRef.current = false;
      };
    }, [load]),
  );

  function toggle(recipeId: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }

  async function handlePlanByHand() {
    setIsCancelling(true);
    try {
      await cancelSelectionRound(roundId);
      router.dismissTo('/');
    } catch {
      // Most often someone else just added the picks; reloading shows that.
      showToast("Couldn't set the round aside — try again");
      setIsCancelling(false);
      void load();
    }
  }

  if (loadError && !loaded) {
    return (
      <View style={styles.screen} testID="results-screen">
        <ErrorState
          title="Couldn't load the matches"
          message="Check your connection and try again."
          onRetry={() => void load()}
          testID="results-load-error"
        />
      </View>
    );
  }

  if (!loaded) {
    return (
      <View style={styles.screen} testID="results-screen">
        <LoadingState label="Counting the votes…" testID="results-loading" />
      </View>
    );
  }

  const { round, sections, completedCount } = loaded;
  const applied = round.status === 'applied';
  const strong = sections.unanimous.length + sections.majority.length;
  const anything = strong + sections.mixed.length > 0;
  // With one clear match or none, single picks wait behind a button (1l) —
  // except once added, when there's no button and the list is read-only.
  const mixedVisible = strong > 1 || showMixed || applied;
  // Keep deck order across sections so review lists them as people saw them.
  const orderedChecked = round.candidates
    .map((candidate) => candidate.recipeId)
    .filter((recipeId) => checked.has(recipeId));
  const appliedByName =
    round.appliedBy === userId
      ? 'You'
      : round.participants.find((p) => p.userId === round.appliedBy)?.displayName;

  function renderSection(key: keyof ResultSections, rows: ResultRow[]) {
    if (rows.length === 0) return null;
    return (
      <View key={key} style={styles.section} testID={`results-section-${key}`}>
        <Text style={styles.sectionTitle}>{SECTION_TITLES[key]}</Text>
        {rows.map((row) => {
          const isChecked = checked.has(row.recipeId);
          return (
            <Pressable
              key={row.recipeId}
              style={[styles.row, key === 'mixed' && styles.rowMixed]}
              onPress={() => toggle(row.recipeId)}
              disabled={applied}
              accessibilityRole="checkbox"
              accessibilityLabel={row.title}
              accessibilityState={{ checked: isChecked, disabled: applied }}
              testID={`results-row-${row.recipeId}`}
            >
              {!applied && <Checkbox checked={isChecked} />}
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {row.title}
                </Text>
                <Text style={styles.rowDetail}>{row.detail}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="results-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.dismissTo('/')}
          accessibilityRole="button"
          testID="results-done"
        >
          <Text style={styles.headerAction}>This Week</Text>
        </Pressable>
        <Text style={styles.title}>
          {applied ? 'Added to This Week' : resultsHeadline(sections)}
        </Text>
        <Text style={styles.subtitle} testID="results-intro">
          {applied
            ? appliedByName
              ? `${appliedByName} added picks from this round to This Week.`
              : 'Picks from this round were added to This Week.'
            : resultsIntro(completedCount, round.participants.length)}
        </Text>
      </View>

      <ScrollView style={styles.list} testID="results-list">
        {anything ? (
          <>
            {renderSection('unanimous', sections.unanimous)}
            {renderSection('majority', sections.majority)}
            {mixedVisible && renderSection('mixed', sections.mixed)}
          </>
        ) : (
          <Text style={styles.empty} testID="results-empty">
            {completedCount === 0
              ? 'Nobody finished, so no picks counted.'
              : 'Nobody picked anything this round.'}
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {applied ? (
          <Button
            title="Back to This Week"
            onPress={() => router.dismissTo('/')}
            testID="results-back"
          />
        ) : (
          <>
            {anything && (
              <Button
                title={`Continue with ${orderedChecked.length}`}
                onPress={() =>
                  router.push(
                    `/smart-selection/${roundId}/review?recipeIds=${orderedChecked.join(',')}`,
                  )
                }
                disabled={orderedChecked.length === 0}
                testID="results-continue"
              />
            )}
            {!mixedVisible && sections.mixed.length > 0 && (
              <Button
                title="See the other picks"
                variant="secondary"
                onPress={() => setShowMixed(true)}
                testID="results-show-mixed"
              />
            )}
            {
              <Button
                title="Plan it by hand instead"
                variant="secondary"
                onPress={handlePlanByHand}
                disabled={isCancelling}
                testID="results-plan-by-hand"
              />
            }
          </>
        )}
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
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  headerAction: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  list: {
    flex: 1,
  },
  section: {
    paddingTop: spacing.md,
  },
  sectionTitle: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
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
  rowMixed: {
    opacity: 0.7,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  rowDetail: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
});
