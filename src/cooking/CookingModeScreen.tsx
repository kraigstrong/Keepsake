import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type CookingEvent, formatCookedAt, getCookingHistory } from './api';
import { DoneCookingSheet } from './DoneCookingSheet';
import { enqueueCookingEvent } from './outbox';
import { submitPendingCookingEvents } from './outboxEngine';
import { useCookingSession } from './useCookingSession';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { useConnectivity } from '../connectivity/ConnectivityProvider';
import { getDatabase } from '../db/database';
import { useHousehold } from '../household/HouseholdProvider';
import { useCookingModeAwake } from '../keepAwake/useCookingModeAwake';
import { logError } from '../observability';
import { SCALE_PRESETS, scaledIngredientSections } from '../recipes/scaling';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { fetchCurrentWeeklyPlan, removeConfirmedEntryFromThisWeek } from '../thisWeek/api';

export interface CookingModeScreenProps {
  recipeId: string;
}

// Ingredient/instruction lines have no id of their own (ADR-0024's own
// note on this) — keyed positionally, stable for one cooking session.
function checklistKey(sectionIndex: number, lineIndex: number): string {
  return `${sectionIndex}-${lineIndex}`;
}

function CheckableRow({
  label,
  checked,
  onToggle,
  testID,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  testID: string;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      testID={testID}
    >
      <View style={[styles.checkbox, checked && styles.checkboxSelected]}>
        {checked && <Text style={styles.checkmark}>{'✓'}</Text>}
      </View>
      <Text style={[styles.rowLabel, checked && styles.rowLabelChecked]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Single scrolling screen (COOK-01): scale, check off ingredients and
 * instructions, Done Cooking. Keep-awake (COOK-02, Phase 1 risk spike)
 * and checklist persistence (COOK-03/04, ADR-0024) are both delegated —
 * this component is purely the view over useCookingSession's state.
 *
 * Done Cooking opens DoneCookingSheet (COOK-05/06: optional note,
 * optional This-Week removal) rather than completing immediately; the
 * actual completion path (enqueue → clear checklist → sync attempt →
 * navigate back) lives here, unchanged from the plain version, and the
 * sheet is purely what feeds it a note and a remove-from-plan choice.
 */
export function CookingModeScreen({ recipeId }: CookingModeScreenProps) {
  useCookingModeAwake();
  const router = useRouter();
  const { household } = useHousehold();
  const { isOnline } = useConnectivity();
  const { showToast } = useToast();
  const {
    recipe,
    isLoading,
    loadError,
    checkedIngredientKeys,
    checkedInstructionKeys,
    toggleIngredient,
    toggleInstruction,
    resetChecklist,
  } = useCookingSession(recipeId);
  const [multiplier, setMultiplier] = useState(1);
  const [isCompleting, setIsCompleting] = useState(false);
  const [doneCookingSheetVisible, setDoneCookingSheetVisible] = useState(false);
  // Set only when this recipe is on the household's current *confirmed*
  // plan — ADR-0024 decision 4: the removal toggle only ever appears
  // when there's actually a confirmed plan entry to remove.
  const [planEntryId, setPlanEntryId] = useState<string | null>(null);
  // planMultiplier/planLookupDone exist only to default the scale below —
  // a silent scope-narrowing found during Phase 16 review (Cooking Mode
  // never honored the scale This Week already committed to), now
  // confirmed as a real pain point by developer walkthrough feedback.
  const [planMultiplier, setPlanMultiplier] = useState<number | null>(null);
  const [planLookupDone, setPlanLookupDone] = useState(false);
  // Found via live testing, 2026-08-14: neither the recipe's own
  // permanent notes nor its past cooking history showed anywhere in
  // Cooking Mode, despite being exactly the kind of thing worth
  // glancing at mid-recipe ("last time I noted to use less salt").
  // Same always-online, "no offline mirror" call as RecipeDetailScreen's
  // own getCookingHistory usage — a plain useEffect here, not that
  // screen's useFocusEffect, since Cooking Mode is freshly mounted each
  // time it's navigated into rather than staying mounted across a
  // round-trip.
  const [cookingHistory, setCookingHistory] = useState<CookingEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    getCookingHistory(recipeId)
      .then((events) => {
        if (!cancelled) setCookingHistory(events);
      })
      .catch(() => undefined); // supplementary content — a failed load just shows no history, not a broken screen
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentWeeklyPlan()
      .then((plan) => {
        if (cancelled) return;
        const entry =
          plan.status === 'confirmed'
            ? plan.entries.find((candidate) => candidate.recipeId === recipeId)
            : undefined;
        setPlanEntryId(entry ? entry.id : null);
        setPlanMultiplier(entry ? entry.multiplier : null);
      })
      .catch(() => {
        // no confirmed plan — fine, the toggle just won't show and the
        // scale stays at its own default
        if (!cancelled) {
          setPlanEntryId(null);
          setPlanMultiplier(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPlanLookupDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  // Same "adjust state during render" pattern as DoneCookingSheet's own
  // reset, and RecipeDetailScreen's per-recipe reset before it — not an
  // effect, and applied exactly once (`appliedPlanDefault`) so a manual
  // scale-chip tap afterward is never silently overwritten by a slow
  // plan-fetch resolving late. appliedPlanDefault is also set eagerly by
  // the chip's own onPress below (Codex review, PR #50) — the original
  // version only ever set it inside this render-time block, so a chip
  // tap that happened *before* the plan lookup resolved didn't stop this
  // block from later overwriting that manual choice once it did.
  const [appliedPlanDefault, setAppliedPlanDefault] = useState(false);
  if (!appliedPlanDefault && planLookupDone && recipe) {
    setAppliedPlanDefault(true);
    if (planMultiplier != null) {
      setMultiplier(planMultiplier);
    }
  }

  if (isLoading) {
    return <LoadingState label="Loading recipe…" testID="cooking-mode-loading" />;
  }

  if (loadError || !recipe) {
    return (
      <ErrorState
        title="Couldn't load this recipe"
        message="Check your connection and try again."
        testID="cooking-mode-load-error"
      />
    );
  }

  const displayedIngredientSections = scaledIngredientSections(
    recipe.ingredientSections,
    multiplier,
    'original',
    null,
  );

  // Marks the plan default as already "applied" (Codex review, PR #50)
  // even if the plan lookup is still pending — otherwise a chip tap that
  // happens before that lookup resolves gets silently overwritten once
  // it does, by the render-time block above.
  function handleSelectMultiplier(nextMultiplier: number) {
    setAppliedPlanDefault(true);
    setMultiplier(nextMultiplier);
  }

  function announceToggle(nowChecked: boolean, label: string) {
    AccessibilityInfo.announceForAccessibility(
      nowChecked ? `Checked ${label}` : `Unchecked ${label}`,
    );
  }

  async function handleDoneCooking(note: string | null, removeFromPlan: boolean) {
    if (!household || isCompleting) return;
    setIsCompleting(true);
    try {
      const db = await getDatabase();
      await enqueueCookingEvent(db, recipeId, household.id, new Date().toISOString(), note);
      resetChecklist();
      setDoneCookingSheetVisible(false);
      showToast('Nice work — marked as cooked');
      // Best-effort immediate sync; the outbox drain on next
      // foreground/reconnect (app/_layout.tsx) covers it either way.
      submitPendingCookingEvents(household.id).catch(() => undefined);

      // Removal is a direct, connectivity-gated call (ADR-0024 decision
      // 4), never queued — and best-effort relative to the completion
      // above: the cooking event is already recorded by this point, so a
      // failure here shouldn't read as "Done Cooking didn't work."
      if (removeFromPlan && planEntryId) {
        try {
          await removeConfirmedEntryFromThisWeek(planEntryId);
        } catch (error) {
          logError(error, { context: 'removeConfirmedEntryFromThisWeek' });
          showToast("Cooked it, but couldn't remove it from This Week");
        }
      }

      router.back();
    } catch {
      // Unlike the sync attempt above, the *local* enqueue is the actual
      // completion record — if writing it fails outright (e.g. local
      // storage unavailable), there's nothing to retry in the background
      // and the user needs to know Done Cooking didn't actually take.
      showToast("Couldn't record that you cooked this — try again");
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="cooking-mode-screen"
    >
      <Text style={styles.title}>{recipe.title}</Text>

      <View style={styles.chipRow} testID="cooking-mode-scaling-controls">
        {SCALE_PRESETS.map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            selected={multiplier === preset.multiplier}
            onPress={() => handleSelectMultiplier(preset.multiplier)}
            testID={`cooking-mode-scale-preset-${preset.multiplier}`}
          />
        ))}
      </View>

      {recipe.permanentNotes && (
        <View style={styles.section} testID="cooking-mode-notes">
          <Text style={styles.sectionHeading}>Notes</Text>
          <Text style={styles.line}>{recipe.permanentNotes}</Text>
        </View>
      )}

      {cookingHistory.length > 0 && (
        <View style={styles.section} testID="cooking-mode-cooking-history">
          <Text style={styles.sectionHeading}>Cooking History</Text>
          {/* Already newest-first (getCookingHistory) — the most recent
              note is just the first row, same as RecipeDetailScreen's own
              NOTE-03 ordering, not a separate preview element. */}
          {cookingHistory.map((event) => (
            <View key={event.id} style={styles.cookingHistoryRow}>
              <Text style={styles.line}>{formatCookedAt(event.cookedAt)}</Text>
              {event.note && <Text style={styles.cookingHistoryNote}>{event.note}</Text>}
            </View>
          ))}
        </View>
      )}

      {displayedIngredientSections.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={styles.sectionHeading}>{section.title ?? 'Ingredients'}</Text>
          {section.lines.map((line, lineIndex) => {
            const key = checklistKey(sectionIndex, lineIndex);
            const checked = checkedIngredientKeys.has(key);
            return (
              <CheckableRow
                key={key}
                label={line}
                checked={checked}
                onToggle={() => {
                  toggleIngredient(key);
                  announceToggle(!checked, line);
                }}
                testID={`cooking-mode-ingredient-${key}`}
              />
            );
          })}
        </View>
      ))}

      {recipe.instructionSections.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={styles.sectionHeading}>{section.title ?? 'Instructions'}</Text>
          {section.lines.map((line, lineIndex) => {
            const key = checklistKey(sectionIndex, lineIndex);
            const checked = checkedInstructionKeys.has(key);
            return (
              <CheckableRow
                key={key}
                label={line}
                checked={checked}
                onToggle={() => {
                  toggleInstruction(key);
                  announceToggle(!checked, line);
                }}
                testID={`cooking-mode-instruction-${key}`}
              />
            );
          })}
        </View>
      ))}

      <Pressable
        onPress={resetChecklist}
        accessibilityRole="button"
        testID="cooking-mode-reset-button"
      >
        <Text style={styles.resetLabel}>Reset checklist</Text>
      </Pressable>

      <Button
        title="Done Cooking"
        onPress={() => setDoneCookingSheetVisible(true)}
        disabled={isCompleting}
        testID="cooking-mode-done-button"
      />

      <DoneCookingSheet
        visible={doneCookingSheetVisible}
        onDismiss={() => setDoneCookingSheetVisible(false)}
        onConfirm={handleDoneCooking}
        canRemoveFromPlan={planEntryId != null && isOnline}
        isSubmitting={isCompleting}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeading: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  line: {
    ...typography.body,
    color: colors.textPrimary,
  },
  cookingHistoryRow: {
    marginTop: spacing.xs,
  },
  cookingHistoryNote: {
    ...typography.body,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
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
  rowLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  rowLabelChecked: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  resetLabel: {
    ...typography.body,
    color: colors.accent,
    textAlign: 'center',
  },
});
