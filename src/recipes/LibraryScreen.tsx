import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { RecipeSummary } from './api';
import { useAddSheet } from '../components/AddSheetContext';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { Row } from '../components/Row';
import { useHousehold } from '../household/HouseholdProvider';
import { readLocalRecipeSummaries } from '../sync/offlineRecipes';
import { syncHousehold } from '../sync/syncEngine';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Local-first (ADR-0013 / OFF-01): reads from the local SQLite mirror,
 * which works offline and shows instantly. On focus, also best-effort
 * syncs and re-reads so returning from creating/editing a recipe (or
 * regaining connectivity) shows the latest — but a failed sync never
 * surfaces as an error, since the local read already succeeded and
 * that's what offline browsing means. loadError now means the local
 * read itself failed, not "no network."
 */
export function LibraryScreen() {
  const router = useRouter();
  const { open: openAddSheet } = useAddSheet();
  const { household } = useHousehold();
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      readLocalRecipeSummaries()
        .then(async (local) => {
          if (cancelled) return;
          setRecipes(local);
          setLoadError(false);

          if (!household) return;
          await syncHousehold(household.id).catch(() => {
            // Offline or a transient failure — the list stays at
            // whatever was already cached locally.
          });
          if (cancelled) return;

          const refreshed = await readLocalRecipeSummaries().catch(() => null);
          if (!cancelled && refreshed) setRecipes(refreshed);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });

      return () => {
        cancelled = true;
      };
    }, [household]),
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Library</Text>
      <View style={[styles.content, recipes && recipes.length > 0 ? null : styles.centered]}>
        {loadError ? (
          <ErrorState
            title="Couldn't load your recipes"
            message="Something went wrong. Try again."
            testID="library-load-error"
          />
        ) : recipes === null ? (
          <LoadingState label="Loading recipes…" testID="library-loading" />
        ) : recipes.length === 0 ? (
          <EmptyState
            title="No recipes yet"
            message="Recipes you save will show up here."
            actionLabel="Add a recipe"
            onAction={openAddSheet}
            testID="library-placeholder"
          />
        ) : (
          <FlatList
            style={styles.list}
            data={recipes}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Row
                title={item.title}
                onPress={() => router.push(`/recipe/${item.id}`)}
                testID={`library-recipe-${item.id}`}
              />
            )}
            testID="library-recipe-list"
          />
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
  title: {
    ...typography.title,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  content: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
});
