import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchRecipeVersions, restoreRecipeVersion, type RecipeVersionSummary } from './api';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { colors, radii, spacing, typography } from '../theme/tokens';

export interface RecipeVersionHistoryScreenProps {
  recipeId: string;
}

/**
 * prd.md §23/§24: every explicit save is recoverable, reached from the
 * recipe detail screen's History action. Restoring the newest version
 * is disabled — it would just recreate the state already showing, not
 * a meaningful action.
 */
export function RecipeVersionHistoryScreen({ recipeId }: RecipeVersionHistoryScreenProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [versions, setVersions] = useState<RecipeVersionSummary[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchRecipeVersions(recipeId)
      .then((fetched) => {
        if (cancelled) return;
        setVersions(fetched);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  async function handleRestore(versionId: string) {
    setRestoreError(null);
    setRestoringId(versionId);
    try {
      const { id } = await restoreRecipeVersion(versionId);
      router.replace(`/recipe/${id}`);
    } catch {
      setRestoreError('Could not restore that version. Try again.');
      setRestoringId(null);
    }
  }

  if (isLoading) {
    return <LoadingState label="Loading history…" testID="recipe-history-loading" />;
  }

  if (loadError) {
    return (
      <ErrorState
        title="Couldn't load version history"
        message="Check your connection and try again."
        testID="recipe-history-load-error"
      />
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="recipe-history-screen"
    >
      <Text style={styles.title}>History</Text>

      {versions.map((version, index) => (
        <View key={version.id} style={styles.row} testID={`recipe-history-row-${version.id}`}>
          <View style={styles.rowText}>
            <Text style={styles.versionLabel}>Version {version.versionNumber}</Text>
            <Text style={styles.timestamp}>{new Date(version.createdAt).toLocaleString()}</Text>
          </View>
          {index > 0 && (
            <Button
              title={restoringId === version.id ? 'Restoring…' : 'Restore'}
              variant="secondary"
              onPress={() => handleRestore(version.id)}
              disabled={restoringId !== null}
              testID={`recipe-history-restore-${version.id}`}
            />
          )}
        </View>
      ))}

      {restoreError && (
        <Text style={styles.error} testID="recipe-history-error" accessibilityRole="alert">
          {restoreError}
        </Text>
      )}
    </ScrollView>
  );
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
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: radii.sm,
    gap: spacing.md,
  },
  rowText: {
    gap: spacing.xs,
  },
  versionLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  timestamp: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
