import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { importRecipeFromPhoto } from './api';
import { Button } from '../components/Button';
import { LoadingState } from '../components/LoadingState';
import { useHousehold } from '../household/HouseholdProvider';
import { captureFromCamera, pickExistingPhoto, type PickedPhoto } from '../photoImport/photoImport';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Phase 10 (ADR-0017): capture or pick a photo, upload it, let vision
 * extraction do the rest. No mandatory review step (prd.md §8, IMP-07,
 * same as ImportRecipeScreen) — a successful import goes straight to
 * the saved recipe's detail screen; uncertain/partial fields (AI-07,
 * ADR-0017 decision 5) surface there via Phase 4's existing rendering,
 * not a second review UI here. The OS camera/picker sheet already gives
 * the user its own retake/confirm step before returning a photo, so
 * there's no separate in-app preview screen either.
 */
export function PhotoImportScreen() {
  const router = useRouter();
  const { household } = useHousehold();
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePicked(picked: PickedPhoto | null) {
    if (!picked || !household) return;

    setError(null);
    setIsImporting(true);
    try {
      // Same "navigate straight to the recipe either way" reasoning as
      // ImportRecipeScreen — whether this created a new recipe or (in
      // principle, though photo imports have no duplicate-detection key)
      // resolved to an existing one, the useful outcome is landing on
      // the recipe.
      const result = await importRecipeFromPhoto(household.id, picked.uri);
      router.replace(
        `/recipe/${result.recipeId}?imported=1${result.duplicate ? '&duplicate=1' : ''}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong importing that photo.');
    } finally {
      setIsImporting(false);
    }
  }

  if (isImporting) {
    return (
      <LoadingState label="Reading the recipe from your photo…" testID="photo-import-loading" />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Import from a photo</Text>
      <Text style={styles.subtitle}>
        Take a photo of a recipe card or cookbook page, or choose one from your library.
      </Text>

      {error && (
        <View role="alert" accessible>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      <Button
        title="Take Photo"
        onPress={() => {
          captureFromCamera().then(handlePicked);
        }}
        testID="photo-import-camera"
      />
      <Button
        title="Choose Photo"
        variant="secondary"
        onPress={() => {
          pickExistingPhoto().then(handlePicked);
        }}
        testID="photo-import-library"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    fontSize: 28,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
