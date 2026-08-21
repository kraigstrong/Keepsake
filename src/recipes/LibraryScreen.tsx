import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Category, CategoryGroup } from './api';
import { FilterIcon } from '../components/icons/FilterIcon';
import {
  activeFilterCount,
  EMPTY_FILTERS,
  filterRecipes,
  toggleCategoryFilter,
  type LibraryFilters,
} from './libraryFilters';
import { SORT_MODES, sortRecipes, type SortMode } from './librarySort';
import { readSortPreference, writeSortPreference } from './sortPreference';
import { useAddSheet } from '../components/AddSheetContext';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { Row } from '../components/Row';
import { ScreenHeader } from '../components/ScreenHeader';
import { Sheet } from '../components/Sheet';
import { useHousehold } from '../household/HouseholdProvider';
import { useImportActivity } from '../import/ImportActivityContext';
import type { SearchResult } from '../search/search';
import { searchRecipes } from '../search/search';
import {
  readLocalCategories,
  readLocalLibraryRecipes,
  type LibraryRecipe,
} from '../sync/offlineRecipes';
import { syncHousehold } from '../sync/syncEngine';
import { colors, radii, spacing, typography } from '../theme/tokens';

// Short enough that the whole row doesn't wrap or crowd Filters off the
// end (developer UX feedback) — the full names still reach screen
// readers via SORT_ACCESSIBILITY_LABELS below.
const SORT_LABELS: Record<SortMode, string> = {
  smart: 'Smart',
  alphabetical: 'A-Z',
  recentlyAdded: 'Recent',
  frequentlySelected: 'Frequent',
};
const SORT_ACCESSIBILITY_LABELS: Record<SortMode, string> = {
  smart: 'Smart sort',
  alphabetical: 'Alphabetical sort',
  recentlyAdded: 'Recently added sort',
  frequentlySelected: 'Frequently selected sort',
};

const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  protein: 'Protein',
  dish_type: 'Dish Type',
  preparation: 'Preparation',
};
const CATEGORY_GROUP_ORDER: CategoryGroup[] = ['protein', 'dish_type', 'preparation'];

// Debounced, not fired on every keystroke — FTS5 queries are sub-1ms even
// at thousands of recipes (docs/risk-spikes/sqlite-fts.md), so this is
// purely to avoid running one query per typed character, not a
// performance necessity of the query itself.
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Local-first (ADR-0013 / OFF-01/OFF-02): reads from the local SQLite
 * mirror, which works offline and shows instantly. On focus, also
 * best-effort syncs and re-reads so returning from creating/editing a
 * recipe (or regaining connectivity) shows the latest — but a failed
 * sync never surfaces as an error, since the local read already
 * succeeded and that's what offline browsing means. loadError now means
 * the local read itself failed, not "no network."
 *
 * Search query, sort mode, and active filters live in this component's
 * own state, untouched by the focus-triggered reload above — returning
 * to this tab (or an in-place resync) never clears what the user had
 * typed or selected (the phase's "search-state restoration" scope item).
 * Sort mode additionally persists across app restarts via AsyncStorage
 * (sortPreference.ts); query and filters are session-only, matching how
 * every other screen in this app treats transient UI state.
 */
export function LibraryScreen() {
  const router = useRouter();
  const { open: openAddSheet } = useAddSheet();
  const { household } = useHousehold();
  const [recipes, setRecipes] = useState<LibraryRecipe[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState(false);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('smart');
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  useEffect(() => {
    readSortPreference().then(setSortMode);
  }, []);

  // No early setSearchResults(null) for an empty query: searchResults is
  // only ever read below while isSearching is true, so a stale value
  // from a previous query is inert once the query is cleared — no need
  // to reset it, which would mean calling setState synchronously in the
  // effect body.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0 || !household) return;

    const timeout = setTimeout(() => {
      searchRecipes(trimmed, household.id)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, household]);

  // notifyImportCompleted's version bumps on any completed background
  // import (Share Extension drain, outbox retry — app/_layout.tsx),
  // included here so a screen already focused when that happens
  // refreshes too, not just on the next navigation-focus event. Found
  // via live testing, 2026-08-14: the recipe-imported toast fired while
  // still on Library, but the new recipe stayed missing until
  // navigating away and back.
  const { version: importVersion } = useImportActivity();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      // ADR-0020: local reads are household-scoped, so this now waits
      // for the live household context rather than reading unfiltered
      // local rows immediately. Deliberate tradeoff — a fully-offline
      // cold launch (household never fetched) shows a loading state
      // instead of an instant (but unfilterable) local paint; the
      // alternative, falling back to a locally-cached "last known
      // household id," would reopen the exact cross-account leak this
      // scoping exists to close if a wipe failure left a previous
      // account's household id behind too.
      if (!household) return;

      Promise.all([readLocalLibraryRecipes(household.id), readLocalCategories()])
        .then(async ([local, localCategories]) => {
          if (cancelled) return;
          setRecipes(local);
          setCategories(localCategories);
          setLoadError(false);

          await syncHousehold(household.id).catch(() => {
            // Offline or a transient failure — the list stays at
            // whatever was already cached locally.
          });
          if (cancelled) return;

          const [refreshed, refreshedCategories] = await Promise.all([
            readLocalLibraryRecipes(household.id).catch(() => null),
            readLocalCategories().catch(() => null),
          ]);
          if (cancelled) return;
          if (refreshed) setRecipes(refreshed);
          if (refreshedCategories) setCategories(refreshedCategories);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- importVersion isn't read in the body; it's a deliberate trigger so an already-focused screen refreshes when useFocusEffect's callback identity changes, not just on the next real focus event (see the comment above).
    }, [household, importVersion]),
  );

  function chooseSort(mode: SortMode) {
    setSortMode(mode);
    writeSortPreference(mode);
  }

  const isSearching = query.trim().length > 0;
  const filterCount = activeFilterCount(filters);
  const visibleRecipes = isSearching
    ? (searchResults ?? [])
    : sortRecipes(filterRecipes(recipes ?? [], filters), sortMode);

  const categoriesByGroup = CATEGORY_GROUP_ORDER.map((group) => ({
    group,
    options: categories.filter((c) => c.groupName === group),
  })).filter((section) => section.options.length > 0);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Library" />

      {recipes !== null && recipes.length > 0 && (
        <>
          <TextInput
            testID="library-search-input"
            style={styles.searchInput}
            placeholder="Search recipes"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />

          {!isSearching && (
            <View style={styles.controlsRow}>
              <View style={styles.sortRow}>
                {SORT_MODES.map((mode) => (
                  <Chip
                    key={mode}
                    testID={`library-sort-${mode}`}
                    label={SORT_LABELS[mode]}
                    accessibilityLabel={SORT_ACCESSIBILITY_LABELS[mode]}
                    selected={sortMode === mode}
                    onPress={() => chooseSort(mode)}
                  />
                ))}
              </View>
              <Chip
                testID="library-filter-button"
                icon={FilterIcon}
                label={filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
                selected={filterCount > 0}
                onPress={() => setFilterSheetVisible(true)}
              />
            </View>
          )}
        </>
      )}

      <View style={[styles.content, visibleRecipes.length > 0 ? null : styles.centered]}>
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
        ) : isSearching && visibleRecipes.length === 0 ? (
          <EmptyState
            title="No matches"
            message={`Nothing found for "${query.trim()}".`}
            testID="library-search-empty"
          />
        ) : !isSearching && filterCount > 0 && visibleRecipes.length === 0 ? (
          <EmptyState
            title="No recipes match"
            message="Try clearing a filter."
            actionLabel="Clear filters"
            onAction={() => setFilters(EMPTY_FILTERS)}
            testID="library-filtered-empty"
          />
        ) : (
          <FlatList
            style={styles.list}
            data={visibleRecipes}
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

      <Sheet
        visible={filterSheetVisible}
        onDismiss={() => setFilterSheetVisible(false)}
        testID="library-filter-sheet"
      >
        <ScrollView style={styles.filterSheetScroll}>
          {categoriesByGroup.map(({ group, options }) => (
            <View key={group} style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>{CATEGORY_GROUP_LABELS[group]}</Text>
              <View style={styles.chipWrap}>
                {options.map((category) => (
                  <Chip
                    key={category.id}
                    testID={`library-filter-category-${category.id}`}
                    label={category.value}
                    selected={filters.categoryIds.includes(category.id)}
                    onPress={() => setFilters(toggleCategoryFilter(filters, category.id))}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.filterActions}>
          <Chip
            testID="library-filter-clear"
            label="Clear filters"
            onPress={() => setFilters(EMPTY_FILTERS)}
          />
          <Chip
            testID="library-filter-done"
            label="Done"
            selected
            onPress={() => setFilterSheetVisible(false)}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchInput: {
    ...typography.input,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  // A hairline plus a little breathing room, matching how every row
  // divider in this app reads (This Week's list, Row's own divider) —
  // otherwise the filter chips and the recipe list run together with
  // nothing to mark where one ends and the other begins.
  content: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  filterSheetScroll: {
    maxHeight: 400,
  },
  filterSection: {
    marginBottom: spacing.md,
  },
  filterSectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
});
