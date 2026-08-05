import { submitImportJob, type BatchJobStub } from './api';

export interface BatchItemOutcome {
  jobId: string;
  sourceUrl: string;
  status: 'submitted' | 'failed';
  recipeId?: string;
  duplicate?: boolean;
  errorMessage?: string;
}

// Bounds simultaneous Anthropic spend/rate without serializing a
// 20-item batch into minutes of dead time (ADR-0016 decision 4) — a
// pasted list, not a sitewide crawl, so this is sized for the stated
// scale rather than maximum throughput.
const BATCH_SUBMISSION_CONCURRENCY = 3;

/**
 * Fires each still-'processing' job's own Edge Function call, with
 * limited concurrency, and returns a per-item outcome so the caller can
 * render partial failures rather than an all-or-nothing result. Already-
 * terminal jobs (complete/failed from an earlier call — e.g. the user
 * left and returned to the Import Activity screen) are skipped; calling
 * this again for a job already in flight elsewhere is still safe, since
 * the Edge Function itself only ever processes a given job id once
 * (ADR-0016 decision 4) — a duplicate call just gets back the same
 * stored outcome.
 */
export async function processBatchJobs(jobs: BatchJobStub[]): Promise<BatchItemOutcome[]> {
  const pending = jobs.filter((job) => job.status === 'processing');
  const outcomes: BatchItemOutcome[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= pending.length) return;
      const job = pending[index]!;
      try {
        const result = await submitImportJob({ jobId: job.jobId });
        outcomes.push({
          jobId: job.jobId,
          sourceUrl: job.sourceUrl,
          status: 'submitted',
          recipeId: result.recipeId,
          duplicate: result.duplicate,
        });
      } catch (error) {
        outcomes.push({
          jobId: job.jobId,
          sourceUrl: job.sourceUrl,
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  const workerCount = Math.min(BATCH_SUBMISSION_CONCURRENCY, pending.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return outcomes;
}
