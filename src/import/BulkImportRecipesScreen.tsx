import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createImportBatch } from './api';
import { MAX_BULK_IMPORT_URLS, parseBulkUrls } from './parseBulkUrls';
import { Button } from '../components/Button';
import { LoadingState } from '../components/LoadingState';
import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * Bulk URL import (Phase 9, ADR-0016 decision 3): paste a list of
 * recipe links, get them all queued at once. This screen only reserves
 * the batch (createImportBatch is a fast Postgres RPC, no fetching or
 * AI work) and hands off to the Import Activity screen, which is what
 * actually fires each job's Edge Function call and shows progress —
 * "Leave-and-return progress" means this screen shouldn't be the one
 * blocking on N imports finishing.
 */
export function BulkImportRecipesScreen() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urls = useMemo(() => parseBulkUrls(text), [text]);
  const tooMany = urls.length > MAX_BULK_IMPORT_URLS;
  const canSubmit = urls.length > 0 && !tooMany && !isSubmitting;

  async function handleImport() {
    setError(null);
    setIsSubmitting(true);
    try {
      const jobs = await createImportBatch(urls);
      const batchId = jobs[0]?.batchId;
      if (!batchId) {
        setError('Nothing to import.');
        return;
      }
      router.replace(`/recipe/import-batch/${batchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong starting this import.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSubmitting) {
    return <LoadingState label="Starting import…" testID="bulk-import-loading" />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Import multiple recipes</Text>
      <Text style={styles.subtitle}>
        Paste a list of recipe links, one per line — we&apos;ll import them all.
      </Text>

      <TextInput
        testID="bulk-import-input"
        style={styles.input}
        placeholder={'https://example.com/recipe-one\nhttps://example.com/recipe-two'}
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        numberOfLines={8}
        value={text}
        onChangeText={setText}
      />

      <Text style={styles.count} testID="bulk-import-count">
        {urls.length === 0
          ? 'No links found yet'
          : `${urls.length} link${urls.length === 1 ? '' : 's'} found`}
      </Text>

      {tooMany && (
        <View role="alert" accessible>
          <Text style={styles.error}>
            That&apos;s {urls.length} links — please paste {MAX_BULK_IMPORT_URLS} or fewer at a
            time.
          </Text>
        </View>
      )}

      {error && (
        <View role="alert" accessible>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      <Button
        title="Import all"
        onPress={handleImport}
        disabled={!canSubmit}
        testID="bulk-import-submit"
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
    minHeight: 160,
    textAlignVertical: 'top',
  },
  count: {
    ...typography.body,
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
