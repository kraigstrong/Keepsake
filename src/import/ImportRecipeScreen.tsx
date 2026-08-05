import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { importRecipeFromUrl } from './api';
import { Button } from '../components/Button';
import { LoadingState } from '../components/LoadingState';
import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * Phase 8 (ADR-0015): paste a URL, the Edge Function does everything
 * else. No mandatory review step (prd.md §8, IMP-07) — a successful
 * import goes straight to the saved recipe's detail screen, not an
 * intermediate confirm/edit step. Low-confidence fields (AI-07) are
 * still visible once there — they're highlighted on the detail screen
 * itself (Phase 4's existing rendering), not re-litigated here.
 */
export function ImportRecipeScreen() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = url.trim().length > 0 && !isImporting;

  async function handleImport() {
    setError(null);
    setIsImporting(true);
    try {
      // Navigates straight to the recipe either way — whether this
      // created a new recipe or resolved to one that already existed
      // (ADR-0015's duplicate detection), the useful outcome for the
      // user is the same: land on the recipe. There's no intermediate
      // state to show a "this was a duplicate" notice in, since
      // navigation happens immediately after this call resolves.
      const result = await importRecipeFromUrl(url.trim());
      router.replace(`/recipe/${result.recipeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong importing this recipe.');
    } finally {
      setIsImporting(false);
    }
  }

  if (isImporting) {
    return <LoadingState label="Importing recipe…" testID="import-recipe-loading" />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Import from a URL</Text>
      <Text style={styles.subtitle}>
        Paste a link to a recipe page and we&apos;ll pull in the details.
      </Text>

      <TextInput
        testID="import-url-input"
        style={styles.input}
        placeholder="https://example.com/recipe"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={url}
        onChangeText={setUrl}
      />

      {error && (
        <View role="alert" accessible>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      <Button
        title="Import"
        onPress={handleImport}
        disabled={!canSubmit}
        testID="import-url-submit"
      />
    </ScrollView>
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
  input: {
    ...typography.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
