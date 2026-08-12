import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { type ArchivedRecipeSummary, fetchArchivedRecipes, unarchiveRecipe } from './api';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * LIFE-01..03 (Phase 16, ADR-0025). Always online, no local mirror
 * (decision 6) — a rarely-visited screen, same "no offline mirror" call
 * as This Week/cooking history. useFocusEffect (not a plain mount-only
 * effect) so returning here after unarchiving from Recipe Detail
 * (decision 5: Recipe Detail stays reachable for an archived recipe,
 * same screen) shows the up-to-date list rather than a stale one.
 */
export function ArchivedRecipesScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [recipes, setRecipes] = useState<ArchivedRecipeSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    fetchArchivedRecipes()
      .then(setRecipes)
      .catch(() => setLoadError(true));
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  async function handleUnarchive(recipeId: string) {
    try {
      await unarchiveRecipe(recipeId);
      setRecipes((current) => current?.filter((recipe) => recipe.id !== recipeId) ?? current);
      showToast('Recipe unarchived');
    } catch {
      showToast("Couldn't unarchive recipe");
    }
  }

  return (
    <View style={styles.screen}>
      {loadError ? (
        <ErrorState
          title="Couldn't load archived recipes"
          message="Something went wrong. Try again."
          onRetry={load}
          testID="archived-recipes-load-error"
        />
      ) : recipes === null ? (
        <LoadingState label="Loading archived recipes…" testID="archived-recipes-loading" />
      ) : recipes.length === 0 ? (
        <EmptyState
          title="No archived recipes"
          message="Recipes you archive will show up here."
          testID="archived-recipes-empty"
        />
      ) : (
        <FlatList
          style={styles.list}
          data={recipes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowTitle}
                accessibilityRole="button"
                onPress={() => router.push(`/recipe/${item.id}`)}
                testID={`archived-recipe-${item.id}`}
              >
                <Text style={styles.rowTitleText} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
              <Button
                title="Unarchive"
                variant="secondary"
                onPress={() => handleUnarchive(item.id)}
                testID={`archived-recipe-unarchive-${item.id}`}
              />
            </View>
          )}
          testID="archived-recipes-list"
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
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: {
    flex: 1,
  },
  rowTitleText: {
    ...typography.body,
    fontWeight: '500',
    letterSpacing: -0.16,
    color: colors.textPrimary,
  },
});
