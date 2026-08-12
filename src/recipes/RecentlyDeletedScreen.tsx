import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import {
  type DeletedRecipeSummary,
  fetchDeletedRecipes,
  permanentlyDeleteRecipe,
  restoreRecipe,
} from './api';
import { Button } from '../components/Button';
import { confirm } from '../components/confirm';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * LIFE-05..07 (Phase 16, ADR-0025). Always online, no local mirror
 * (decision 6) — shared across the household (decision 5), so a stale
 * local copy would be actively misleading here more than most screens.
 * No row-to-Recipe-Detail navigation: unlike Archived Recipes (decision
 * 5's explicit "navigates into it, same screen"), this ADR never
 * describes viewing a deleted recipe's full detail — Restore/Permanently
 * Delete are the only two actions this list needs to offer.
 */
export function RecentlyDeletedScreen() {
  const { showToast } = useToast();
  const [recipes, setRecipes] = useState<DeletedRecipeSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    fetchDeletedRecipes()
      .then(setRecipes)
      .catch(() => setLoadError(true));
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  function removeFromList(recipeId: string) {
    setRecipes((current) => current?.filter((recipe) => recipe.id !== recipeId) ?? current);
  }

  async function handleRestore(recipeId: string) {
    try {
      await restoreRecipe(recipeId);
      removeFromList(recipeId);
      showToast('Recipe restored');
    } catch {
      showToast("Couldn't restore recipe");
    }
  }

  // LIFE-07, ADR-0025 decision 9: the truly irreversible action, so it
  // gets its own confirm() even though delete_recipe (soft) already
  // required one to get here.
  async function handlePermanentlyDelete(recipeId: string, title: string) {
    const confirmed = await confirm({
      title: `Permanently delete "${title}"?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete Forever',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await permanentlyDeleteRecipe(recipeId);
      removeFromList(recipeId);
      showToast('Recipe permanently deleted');
    } catch {
      showToast("Couldn't permanently delete recipe");
    }
  }

  return (
    <View style={styles.screen}>
      {loadError ? (
        <ErrorState
          title="Couldn't load Recently Deleted"
          message="Something went wrong. Try again."
          onRetry={load}
          testID="recently-deleted-load-error"
        />
      ) : recipes === null ? (
        <LoadingState label="Loading Recently Deleted…" testID="recently-deleted-loading" />
      ) : recipes.length === 0 ? (
        <EmptyState
          title="Recently Deleted is empty"
          message="Recipes you delete will show up here until restored or permanently deleted."
          testID="recently-deleted-empty"
        />
      ) : (
        <FlatList
          style={styles.list}
          data={recipes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`recently-deleted-recipe-${item.id}`}>
              <Text style={styles.rowTitleText} numberOfLines={1}>
                {item.title}
              </Text>
              <View style={styles.rowActions}>
                <Button
                  title="Restore"
                  variant="secondary"
                  onPress={() => handleRestore(item.id)}
                  testID={`recently-deleted-restore-${item.id}`}
                />
                <Button
                  title="Delete Forever"
                  variant="secondary"
                  onPress={() => handlePermanentlyDelete(item.id, item.title)}
                  testID={`recently-deleted-permanently-delete-${item.id}`}
                />
              </View>
            </View>
          )}
          testID="recently-deleted-list"
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
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitleText: {
    ...typography.body,
    fontWeight: '500',
    letterSpacing: -0.16,
    color: colors.textPrimary,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
