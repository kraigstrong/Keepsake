import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchRecipes, type RecipeSummary } from '../recipes/api';
import { SCALE_PRESETS } from '../recipes/scaling';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { addRecipesToThisWeek } from './api';

// ADR-0018: presets are screen-local and reset every visit, same as
// RecipeDetailScreen's own scaling controls.
const DEFAULT_MULTIPLIER = 1;

export interface AddToThisWeekScreenProps {
  planId: string;
}

type Step = 'select' | 'servings';

export function AddToThisWeekScreen({ planId }: AddToThisWeekScreenProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('select');
  const [query, setQuery] = useState('');
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // ADR-0026 amendment (developer decision, 2026-08-14): every recipe
  // gets the same scale-multiplier chips here, regardless of whether
  // recipe.servingsCount is known — a servings-based stepper existed
  // for that case (decision 3) but its per-recipe row didn't fit
  // compactly next to a long title, and the two different control
  // types read as inconsistent across a mixed selection. servingsCount
  // is still shown on Recipe Detail; it just no longer picks the
  // control type on this screen.
  const [multiplierById, setMultiplierById] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRecipes()
      .then((result) => {
        if (!cancelled) setRecipes(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((selected) => selected !== id) : [...prev, id],
    );
  }

  function goToServingsStep() {
    setMultiplierById((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) {
        if (next[id] === undefined) {
          next[id] = DEFAULT_MULTIPLIER;
        }
      }
      return next;
    });
    setStep('servings');
  }

  // One batch RPC call, not a client-side loop (Codex review, PR #36):
  // the previous sequential-per-recipe approach left a partially-applied
  // selection on a mid-loop failure, and retrying it risked duplicating
  // whichever recipes had already succeeded. add_recipes_to_weekly_plan
  // validates and inserts the whole selection in one transaction — it's
  // all or nothing, so there's no partial state to reconcile on retry.
  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      await addRecipesToThisWeek(
        planId,
        selectedIds.map((id) => ({
          recipeId: id,
          multiplier: multiplierById[id] ?? DEFAULT_MULTIPLIER,
        })),
      );
      showToast(
        selectedIds.length === 1
          ? 'Added 1 recipe to This Week'
          : `Added ${selectedIds.length} recipes to This Week`,
      );
      router.back();
    } catch {
      showToast("Couldn't add those recipes");
    } finally {
      setIsSubmitting(false);
    }
  }

  const visibleRecipes = (recipes ?? []).filter((recipe) =>
    recipe.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectedRecipes = (recipes ?? []).filter((recipe) => selectedIds.includes(recipe.id));

  return (
    <View style={styles.screen} testID="add-to-this-week-screen">
      {/* headerShown: false (app/this-week/add.tsx) — no native header to
          reserve safe-area space here, so this modal-style screen has to
          clear the Dynamic Island/notch itself. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => (step === 'servings' ? setStep('select') : router.back())}
          accessibilityRole="button"
          accessibilityLabel={step === 'servings' ? 'Back' : 'Cancel'}
          testID="add-to-this-week-back"
        >
          <Text style={styles.headerAction}>{step === 'servings' ? 'Back' : 'Cancel'}</Text>
        </Pressable>
        <Text style={styles.title}>{step === 'select' ? 'Add Recipes' : 'Choose Servings'}</Text>
        <View style={styles.headerActionSpacer} />
      </View>

      {step === 'select' ? (
        <>
          {loadError ? (
            <ErrorState
              title="Couldn't load your recipes"
              message="Check your connection and try again."
              testID="add-to-this-week-load-error"
            />
          ) : recipes === null ? (
            <LoadingState label="Loading recipes…" testID="add-to-this-week-loading" />
          ) : (
            <>
              <TextInput
                style={styles.searchInput}
                placeholder="Search recipes"
                placeholderTextColor={colors.textTertiary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                testID="add-to-this-week-search"
              />
              <ScrollView style={styles.list}>
                {visibleRecipes.map((recipe) => {
                  const selected = selectedIds.includes(recipe.id);
                  return (
                    <Pressable
                      key={recipe.id}
                      style={styles.row}
                      onPress={() => toggleSelected(recipe.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      testID={`add-to-this-week-recipe-${recipe.id}`}
                    >
                      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected && <Text style={styles.checkmark}>{'✓'}</Text>}
                      </View>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {recipe.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Button
              title={selectedIds.length === 0 ? 'Select recipes to continue' : 'Next'}
              onPress={goToServingsStep}
              disabled={selectedIds.length === 0}
              testID="add-to-this-week-next"
            />
          </View>
        </>
      ) : (
        <>
          <ScrollView style={styles.list}>
            {selectedRecipes.map((recipe) => (
              <View
                key={recipe.id}
                style={styles.chipsRow}
                testID={`add-to-this-week-servings-${recipe.id}`}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {recipe.title}
                </Text>
                <View style={styles.chipGroup}>
                  {SCALE_PRESETS.map((preset) => (
                    <Chip
                      key={preset.label}
                      label={preset.label}
                      selected={
                        (multiplierById[recipe.id] ?? DEFAULT_MULTIPLIER) === preset.multiplier
                      }
                      onPress={() =>
                        setMultiplierById((prev) => ({ ...prev, [recipe.id]: preset.multiplier }))
                      }
                      testID={`add-to-this-week-scale-preset-${recipe.id}-${preset.multiplier}`}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Button
              title="Add to This Week"
              onPress={handleSubmit}
              disabled={isSubmitting}
              testID="add-to-this-week-submit"
            />
          </View>
        </>
      )}
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
    paddingTop: spacing.sm,
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
  searchInput: {
    ...typography.input,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  list: {
    flex: 1,
    marginTop: spacing.sm,
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
  rowTitle: {
    ...typography.body,
    fontWeight: '500',
    letterSpacing: -0.16,
    color: colors.textPrimary,
    flex: 1,
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
  footer: {
    padding: spacing.lg,
  },
});
