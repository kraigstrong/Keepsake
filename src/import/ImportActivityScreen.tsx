import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchBatchJobs, type BatchJobStub } from './api';
import { processBatchJobs } from './batchEngine';
import { LoadingState } from '../components/LoadingState';
import { colors, radii, spacing, typography } from '../theme/tokens';

const POLL_INTERVAL_MS = 1500;

function statusLabel(job: BatchJobStub): string {
  switch (job.status) {
    case 'processing':
      return 'Importing…';
    case 'complete':
      return job.duplicate ? 'Already in your library' : 'Imported';
    case 'failed':
      return job.errorMessage ?? 'Failed';
    default:
      return job.status;
  }
}

function isStillProcessing(jobs: BatchJobStub[]): boolean {
  return jobs.some((job) => job.status === 'processing');
}

export interface ImportActivityScreenProps {
  batchId: string;
  // Overridable so tests aren't forced to wait out the real interval.
  pollIntervalMs?: number;
}

/**
 * "Leave-and-return progress" (Phase 9 build scope, ADR-0016 decision
 * 4) — this screen doesn't hold a request open for N imports to finish.
 * It polls import_jobs for the batch's real server-side status, and
 * fires submission for anything still 'processing' on mount, including
 * a return visit after the app was closed mid-batch: that's what makes
 * leaving and coming back actually resume work rather than leaving jobs
 * stuck. Re-firing is safe even if a submission from an earlier visit
 * is still genuinely in flight — the Edge Function only ever processes
 * a given job id once (ADR-0016 decision 4), so a duplicate call just
 * gets back the same stored outcome.
 */
export function ImportActivityScreen({
  batchId,
  pollIntervalMs = POLL_INTERVAL_MS,
}: ImportActivityScreenProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<BatchJobStub[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const startedProcessingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function refresh(): Promise<BatchJobStub[] | null> {
      try {
        const current = await fetchBatchJobs(batchId);
        if (cancelled) return null;
        setJobs(current);
        return current;
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load import progress.');
        }
        return null;
      }
    }

    async function start() {
      const initial = await refresh();
      if (!initial) return;

      if (!startedProcessingRef.current) {
        startedProcessingRef.current = true;
        // Outcomes are surfaced by polling below, not this call's own
        // return value — that's what lets a second visit to this same
        // screen (or the same poll loop) reflect a submission that was
        // actually driven by the *first* visit.
        processBatchJobs(initial).catch(() => {});
      }

      if (isStillProcessing(initial)) {
        intervalId = setInterval(() => {
          void (async () => {
            const latest = await refresh();
            if (latest && !isStillProcessing(latest) && intervalId) {
              clearInterval(intervalId);
            }
          })();
        }, pollIntervalMs);
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [batchId, pollIntervalMs]);

  if (loadError) {
    return (
      <View style={styles.container}>
        <View role="alert" accessible>
          <Text style={styles.error}>{loadError}</Text>
        </View>
      </View>
    );
  }

  if (!jobs) {
    return <LoadingState label="Loading import…" testID="import-activity-loading" />;
  }

  const completedCount = jobs.filter((job) => job.status === 'complete').length;
  const failedCount = jobs.filter((job) => job.status === 'failed').length;
  const done = !isStillProcessing(jobs);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Importing {jobs.length} recipes</Text>
      <Text style={styles.summary} testID="import-activity-summary">
        {done
          ? `${completedCount} imported${failedCount > 0 ? `, ${failedCount} failed` : ''}`
          : `${completedCount + failedCount} of ${jobs.length} done`}
      </Text>

      {jobs.map((job) => (
        <View key={job.jobId} style={styles.row} testID={`import-activity-row-${job.jobId}`}>
          <Text style={styles.url} numberOfLines={1}>
            {job.sourceUrl}
          </Text>
          {job.status === 'complete' && job.recipeId ? (
            <Pressable
              onPress={() => router.push(`/recipe/${job.recipeId}`)}
              testID={`import-activity-row-${job.jobId}-open`}
            >
              <Text style={styles.statusSuccess}>{statusLabel(job)}</Text>
            </Pressable>
          ) : (
            <Text style={job.status === 'failed' ? styles.statusFailed : styles.statusPending}>
              {statusLabel(job)}
            </Text>
          )}
        </View>
      ))}
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
  summary: {
    ...typography.body,
    color: colors.textSecondary,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  url: {
    ...typography.body,
    color: colors.textPrimary,
  },
  statusPending: {
    ...typography.body,
    color: colors.textSecondary,
  },
  statusSuccess: {
    ...typography.body,
    color: colors.accent,
  },
  statusFailed: {
    ...typography.body,
    color: colors.danger,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
