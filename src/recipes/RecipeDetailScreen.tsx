import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { convertToSystem } from '../../server/units/convertUnit';
import { formatIngredientLine } from '../../server/units/formatIngredientLine';
import type { UnitSystem } from '../../server/units/quantityVocabulary';
import { scaleQuantity } from '../../server/units/scaleQuantity';
import {
  type Category,
  fetchCategories,
  fetchRecipe,
  type IngredientSection,
  type Recipe,
} from './api';
import { getHeroImageUrl } from './heroImage';
import { Chip } from '../components/Chip';
import { ErrorState } from '../components/ErrorState';
import { ImagePlaceholder } from '../components/ImagePlaceholder';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { fetchProfile } from '../household/api';
import { useSession } from '../session/SessionProvider';
import {
  cacheHeroImage,
  readCachedImageUri,
  readLocalCategories,
  readLocalRecipe,
} from '../sync/offlineRecipes';
import { colors, radii, spacing, typography } from '../theme/tokens';

// ADR-0018: presets are screen-local and reset every visit — a recipe
// never "remembers" a prior scaling, Original is always one tap away.
const SCALE_PRESETS: { label: string; multiplier: number }[] = [
  { label: '½×', multiplier: 0.5 },
  { label: '1×', multiplier: 1 },
  { label: '1½×', multiplier: 1.5 },
  { label: '2×', multiplier: 2 },
  { label: '3×', multiplier: 3 },
  { label: '4×', multiplier: 4 },
];

function scaledIngredientSections(
  sections: IngredientSection[],
  multiplier: number,
  displayMode: 'original' | 'preferred',
  preferredUnitSystem: UnitSystem | null,
): { title: string | null; lines: string[] }[] {
  return sections.map((section) => ({
    title: section.title,
    lines: section.lines.map((line) => {
      let quantity = scaleQuantity(line, multiplier);
      if (displayMode === 'preferred' && preferredUnitSystem) {
        quantity = convertToSystem(quantity, preferredUnitSystem);
      }
      return formatIngredientLine({ ...line, ...quantity });
    }),
  }));
}

export interface RecipeDetailScreenProps {
  recipeId: string;
  // Set when this screen was reached straight from a successful import
  // (ImportRecipeScreen's router.replace) — the recipe is already saved
  // by the time we land here (IMP-07: no mandatory review step), but
  // without any signal the user has no way to tell "this just got
  // imported" apart from "I navigated to an existing recipe." A toast
  // is the whole fix; it doesn't add a review step.
  justImported?: boolean;
  // Whether that import resolved to an already-saved recipe (ADR-0015
  // duplicate detection) rather than creating a new one — changes the
  // toast wording, nothing else.
  wasDuplicate?: boolean;
}

/**
 * Read-only view of a saved recipe — editing happens on a separate
 * screen (/recipe/[id]/edit) reached via the Edit action below, rather
 * than an inline-editable detail view, matching REC-09's "no clutter"
 * shape (nothing here but what's meant to be read while cooking).
 */
export function RecipeDetailScreen({
  recipeId,
  justImported = false,
  wasDuplicate = false,
}: RecipeDetailScreenProps) {
  const router = useRouter();
  const { session } = useSession();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [preferredUnitSystem, setPreferredUnitSystem] = useState<UnitSystem | null>(null);
  // Both screen-local, reset every visit (ADR-0018) — never persisted.
  const [displayMode, setDisplayMode] = useState<'original' | 'preferred'>('preferred');
  const [multiplier, setMultiplier] = useState(1);
  // Resets scaling state when navigating to a different recipe, without a
  // setState-in-effect render cascade — adjusting state during render
  // itself (React's own documented pattern for "reset state when a prop
  // changes") rather than in a useEffect.
  const [scaleStateRecipeId, setScaleStateRecipeId] = useState(recipeId);
  if (recipeId !== scaleStateRecipeId) {
    setScaleStateRecipeId(recipeId);
    setDisplayMode('preferred');
    setMultiplier(1);
  }
  // Crossfades the hero image in over the placeholder once it's ready,
  // rather than an instant swap — the placeholder never unmounts, it
  // just gets covered, so there's no layout jump alongside the fade.
  // useState's lazy initializer, not useRef — same reasoning as
  // Sheet.tsx's `progress`: Animated.Value is read directly during
  // render, and useRef().current trips react-hooks/refs even though
  // this exact pattern is correct here.
  const [heroOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (justImported) showToast(wasDuplicate ? 'Already in your library' : 'Recipe imported');
    // Only ever meant to fire once, right when this screen is reached
    // straight from a successful import — not on every re-render, and
    // not again if the same recipeId is somehow revisited later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    let cancelled = false;
    fetchProfile(userId).then((profile) => {
      if (!cancelled && profile) setPreferredUnitSystem(profile.preferredUnitSystem);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    heroOpacity.setValue(0);

    // Local-first (ADR-0013 / OFF-01): a cache hit shows instantly and
    // works offline. A live fetch always runs alongside/after it too —
    // covers a recipe not yet synced to this device, and refreshes
    // stale local data when online. The live fetch's failure only
    // becomes a visible error if the local read had nothing to show;
    // otherwise it's silently offline and the local data stands.
    async function loadHeroImage(heroImagePath: string | null) {
      if (!heroImagePath || cancelled) return;
      const cachedUri = await readCachedImageUri(heroImagePath).catch(() => null);
      if (cancelled) return;
      if (cachedUri) {
        setHeroImageUrl(cachedUri);
        return;
      }
      const signedUrl = await getHeroImageUrl(heroImagePath).catch(() => null);
      if (!signedUrl || cancelled) return;
      // Cache it now, not just display it — otherwise a recipe from a
      // just-completed import (which hasn't had a full sync pass yet,
      // Phase 6's own pre-caching) stays slow to view *every* time,
      // re-fetching a signed URL and re-downloading over the network on
      // every visit rather than only the first.
      const localUri = await cacheHeroImage(heroImagePath, signedUrl).catch(() => null);
      if (!cancelled) setHeroImageUrl(localUri ?? signedUrl);
    }

    async function load() {
      let haveData = false;

      const [localRecipe, localCategories] = await Promise.all([
        readLocalRecipe(recipeId).catch(() => null),
        readLocalCategories().catch(() => [] as Category[]),
      ]);
      if (cancelled) return;
      if (localRecipe) {
        haveData = true;
        setRecipe(localRecipe);
        setCategories(localCategories);
        setIsLoading(false);
        loadHeroImage(localRecipe.heroImagePath);
      }

      try {
        const [freshRecipe, freshCategories] = await Promise.all([
          fetchRecipe(recipeId),
          fetchCategories(),
        ]);
        if (cancelled) return;
        setRecipe(freshRecipe);
        setCategories(freshCategories);
        setIsLoading(false);
        setLoadError(false);
        loadHeroImage(freshRecipe.heroImagePath);
      } catch {
        if (cancelled || haveData) return;
        setLoadError(true);
        setIsLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // heroOpacity's identity never changes (useState with no setter
    // call) — listed to satisfy exhaustive-deps, not because it should
    // ever actually re-trigger this effect.
  }, [recipeId, heroOpacity]);

  if (isLoading) {
    return <LoadingState label="Loading recipe…" testID="recipe-detail-loading" />;
  }

  if (loadError || !recipe) {
    return (
      <ErrorState
        title="Couldn't load this recipe"
        message="Check your connection and try again."
        testID="recipe-detail-load-error"
      />
    );
  }

  const categoryValues = recipe.categoryIds
    .map((id) => categories.find((category) => category.id === id)?.value)
    .filter((value): value is string => value != null);

  const scaledServings =
    recipe.servingsCount != null
      ? Math.max(1, Math.round(recipe.servingsCount * multiplier))
      : null;

  const timingParts = [
    recipe.activeTimeMinutes != null ? `Active ${recipe.activeTimeMinutes} min` : null,
    recipe.totalTimeMinutes != null ? `Total ${recipe.totalTimeMinutes} min` : null,
    scaledServings != null && multiplier !== 1 ? `Serves ${scaledServings}` : recipe.yieldText,
  ].filter((part): part is string => part != null);

  const displayedIngredientSections = scaledIngredientSections(
    recipe.ingredientSections,
    multiplier,
    displayMode,
    preferredUnitSystem,
  );

  function adjustServings(delta: number) {
    if (!recipe?.servingsCount || scaledServings == null) return;
    const nextServings = Math.max(1, scaledServings + delta);
    setMultiplier(nextServings / recipe.servingsCount);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="recipe-detail-screen"
    >
      <View style={styles.heroContainer}>
        <ImagePlaceholder width="100%" height={200} testID="recipe-hero-placeholder" />
        {heroImageUrl && (
          <Animated.Image
            source={{ uri: heroImageUrl }}
            style={[styles.heroImage, styles.heroImageOverlay, { opacity: heroOpacity }]}
            onLoad={() => {
              Animated.timing(heroOpacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
              }).start();
            }}
            testID="recipe-hero"
          />
        )}
      </View>

      <Text style={styles.title}>{recipe.title}</Text>

      {timingParts.length > 0 && <Text style={styles.timing}>{timingParts.join(' · ')}</Text>}

      {(categoryValues.length > 0 || recipe.tags.length > 0) && (
        <View style={styles.chipRow}>
          {categoryValues.map((value) => (
            <Chip key={value} label={value} testID={`recipe-detail-category-${value}`} />
          ))}
          {recipe.tags.map((tag) => (
            <Chip key={tag} label={tag} testID={`recipe-detail-tag-${tag}`} />
          ))}
        </View>
      )}

      <View style={styles.scalingControls} testID="recipe-scaling-controls">
        <View style={styles.chipRow}>
          {SCALE_PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              label={preset.label}
              selected={multiplier === preset.multiplier}
              onPress={() => setMultiplier(preset.multiplier)}
              testID={`recipe-scale-preset-${preset.multiplier}`}
            />
          ))}
        </View>

        {scaledServings != null && (
          <View style={styles.servingsRow} testID="recipe-servings-stepper">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fewer servings"
              onPress={() => adjustServings(-1)}
              testID="recipe-servings-decrement"
            >
              <Text style={styles.servingsButton}>−</Text>
            </Pressable>
            <Text style={styles.servingsLabel}>{scaledServings} servings</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More servings"
              onPress={() => adjustServings(1)}
              testID="recipe-servings-increment"
            >
              <Text style={styles.servingsButton}>+</Text>
            </Pressable>
          </View>
        )}

        {preferredUnitSystem && (
          <View style={styles.chipRow}>
            <Chip
              label="Original"
              selected={displayMode === 'original'}
              onPress={() => setDisplayMode('original')}
              testID="recipe-display-original"
            />
            <Chip
              label="Preferred"
              selected={displayMode === 'preferred'}
              onPress={() => setDisplayMode('preferred')}
              testID="recipe-display-preferred"
            />
          </View>
        )}
      </View>

      {displayedIngredientSections.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={styles.sectionHeading}>{section.title ?? 'Ingredients'}</Text>
          {section.lines.map((line, lineIndex) => (
            <Text key={lineIndex} style={styles.line}>
              {'•'} {line}
            </Text>
          ))}
        </View>
      ))}

      {recipe.instructionSections.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={styles.sectionHeading}>{section.title ?? 'Instructions'}</Text>
          {section.lines.map((line, lineIndex) => (
            <Text key={lineIndex} style={styles.line}>
              {lineIndex + 1}. {line}
            </Text>
          ))}
        </View>
      ))}

      {recipe.permanentNotes && (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Notes</Text>
          <Text style={styles.line}>{recipe.permanentNotes}</Text>
        </View>
      )}

      {(recipe.sourceUrl ?? recipe.sourceAttribution) && (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Source</Text>
          {recipe.sourceAttribution && <Text style={styles.line}>{recipe.sourceAttribution}</Text>}
          {recipe.sourceUrl && (
            <Pressable
              onPress={() => openExternalUrl(recipe.sourceUrl)}
              testID="recipe-detail-source-url"
            >
              <Text style={[styles.line, styles.link]}>{recipe.sourceUrl}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          style={styles.editButton}
          accessibilityRole="button"
          onPress={() => router.push(`/recipe/${recipeId}/edit`)}
          testID="recipe-detail-edit-button"
        >
          <Text style={styles.editButtonLabel}>Edit</Text>
        </Pressable>
        <Pressable
          style={styles.editButton}
          accessibilityRole="button"
          onPress={() => router.push(`/recipe/${recipeId}/history`)}
          testID="recipe-detail-history-button"
        >
          <Text style={styles.editButtonLabel}>History</Text>
        </Pressable>
        {recipe.originalPhotoPath && (
          <Pressable
            style={styles.editButton}
            accessibilityRole="button"
            onPress={() =>
              router.push(
                `/recipe/${recipeId}/original-photo?path=${encodeURIComponent(recipe.originalPhotoPath!)}`,
              )
            }
            testID="recipe-detail-original-photo-button"
          >
            <Text style={styles.editButtonLabel}>Original Photo</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function openExternalUrl(url: string | null) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  Linking.openURL(url);
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
  heroContainer: {
    width: '100%',
    height: 200,
  },
  heroImage: {
    width: '100%',
    height: 200,
    borderRadius: radii.md,
  },
  heroImageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  timing: {
    ...typography.body,
    color: colors.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  scalingControls: {
    gap: spacing.sm,
  },
  servingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  servingsButton: {
    ...typography.heading,
    color: colors.accent,
    paddingHorizontal: spacing.sm,
  },
  servingsLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeading: {
    ...typography.heading,
    fontSize: 15,
    color: colors.textPrimary,
  },
  line: {
    ...typography.body,
    color: colors.textPrimary,
  },
  link: {
    color: colors.accent,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editButtonLabel: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
