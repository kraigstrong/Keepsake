import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { fetchRecipes, type RecipeSummary } from './api';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { Row } from '../components/Row';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Refetches on focus (rather than a plain mount-only effect) so
 * returning from creating/editing a recipe shows the change — tabs
 * stay mounted across switches in this app's navigator, so a
 * mount-only fetch would go stale after the first visit.
 */
export function LibraryScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      fetchRecipes()
        .then((fetched) => {
          if (cancelled) return;
          setRecipes(fetched);
          setLoadError(false);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Library</Text>
      <View style={[styles.content, recipes && recipes.length > 0 ? null : styles.centered]}>
        {loadError ? (
          <ErrorState
            title="Couldn't load your recipes"
            message="Check your connection and try again."
            testID="library-load-error"
          />
        ) : recipes === null ? (
          <LoadingState label="Loading recipes…" testID="library-loading" />
        ) : recipes.length === 0 ? (
          <EmptyState
            title="No recipes yet"
            message="Recipes you save will show up here."
            actionLabel="Add a recipe"
            onAction={() => router.push('/recipe/new')}
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
