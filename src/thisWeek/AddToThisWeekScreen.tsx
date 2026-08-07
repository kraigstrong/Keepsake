import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { fetchRecipes, type RecipeSummary } from '../recipes/api';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { addRecipesToThisWeek } from './api';

// Same "typical household" default RecipeDetailScreen falls back to
// when a recipe has no parseable serving count — this flow has no
// per-recipe context to scale from at all (WEEK-02's "choose servings"
// step, not a scaled detail view), so every selection starts here and
// is freely adjustable via the stepper below.
const DEFAULT_SERVINGS = 4;
const MIN_SERVINGS = 1;

export interface AddToThisWeekScreenProps {
  planId: string;
}

type Step = 'select' | 'servings';

export function AddToThisWeekScreen({ planId }: AddToThisWeekScreenProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('select');
  const [query, setQuery] = useState('');
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [servingsById, setServingsById] = useState<Record<string, number>>({});
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
    setServingsById((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) {
        if (next[id] === undefined) next[id] = DEFAULT_SERVINGS;
      }
      return next;
    });
    setStep('servings');
  }

  function adjustServings(id: string, delta: number) {
    setServingsById((prev) => ({
      ...prev,
      [id]: Math.max(MIN_SERVINGS, (prev[id] ?? DEFAULT_SERVINGS) + delta),
    }));
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
        selectedIds.map((id) => ({ recipeId: id, servings: servingsById[id] ?? DEFAULT_SERVINGS })),
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
      <View style={styles.header}>
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
          <View style={styles.footer}>
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
                style={styles.row}
                testID={`add-to-this-week-servings-${recipe.id}`}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {recipe.title}
                </Text>
                <View style={styles.servingsStepper}>
                  <Pressable
                    onPress={() => adjustServings(recipe.id, -1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Fewer servings for ${recipe.title}`}
                    hitSlop={8}
                    testID={`add-to-this-week-servings-decrement-${recipe.id}`}
                  >
                    <Text style={styles.servingsButton}>{'−'}</Text>
                  </Pressable>
                  <Text style={styles.servingsLabel}>
                    {servingsById[recipe.id] ?? DEFAULT_SERVINGS}
                  </Text>
                  <Pressable
                    onPress={() => adjustServings(recipe.id, 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`More servings for ${recipe.title}`}
                    hitSlop={8}
                    testID={`add-to-this-week-servings-increment-${recipe.id}`}
                  >
                    <Text style={styles.servingsButton}>{'+'}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
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
  servingsStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  servingsButton: {
    ...typography.heading,
    color: colors.accent,
    paddingHorizontal: spacing.xs,
  },
  servingsLabel: {
    ...typography.body,
    color: colors.textPrimary,
    minWidth: 18,
    textAlign: 'center',
  },
  footer: {
    padding: spacing.lg,
  },
});
