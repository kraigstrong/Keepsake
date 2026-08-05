import { processBatchJobs } from './batchEngine';
import { submitImportJob } from './api';
import type { BatchJobStub } from './api';

jest.mock('./api', () => ({ submitImportJob: jest.fn() }));

const mockedSubmitImportJob = submitImportJob as jest.Mock;

afterEach(() => jest.clearAllMocks());

function job(overrides: Partial<BatchJobStub> = {}): BatchJobStub {
  return {
    batchId: 'b1',
    jobId: 'j1',
    sourceUrl: 'https://example.com/a',
    status: 'processing',
    ...overrides,
  };
}

describe('processBatchJobs', () => {
  it('skips jobs that are already terminal (a leave-and-return re-check)', async () => {
    const jobs = [
      job({ jobId: 'j1', status: 'complete' }),
      job({ jobId: 'j2', status: 'failed' }),
      job({ jobId: 'j3', status: 'processing' }),
    ];
    mockedSubmitImportJob.mockResolvedValue({ jobId: 'j3', recipeId: 'r3', duplicate: false });

    await processBatchJobs(jobs);

    expect(mockedSubmitImportJob).toHaveBeenCalledTimes(1);
    expect(mockedSubmitImportJob).toHaveBeenCalledWith({ jobId: 'j3' });
  });

  it('records a submitted outcome with the resulting recipe on success', async () => {
    mockedSubmitImportJob.mockResolvedValue({ jobId: 'j1', recipeId: 'r1', duplicate: false });

    const outcomes = await processBatchJobs([job({ jobId: 'j1' })]);

    expect(outcomes).toEqual([
      {
        jobId: 'j1',
        sourceUrl: 'https://example.com/a',
        status: 'submitted',
        recipeId: 'r1',
        duplicate: false,
      },
    ]);
  });

  it('records a failed outcome with the error message on failure, without throwing', async () => {
    mockedSubmitImportJob.mockRejectedValue(new Error('Could not fetch the page'));

    const outcomes = await processBatchJobs([job({ jobId: 'j1' })]);

    expect(outcomes).toEqual([
      {
        jobId: 'j1',
        sourceUrl: 'https://example.com/a',
        status: 'failed',
        errorMessage: 'Could not fetch the page',
      },
    ]);
  });

  it('processes every job even when some fail and some succeed', async () => {
    mockedSubmitImportJob.mockImplementation(async ({ jobId }: { jobId: string }) => {
      if (jobId === 'bad') throw new Error('boom');
      return { jobId, recipeId: `r-${jobId}`, duplicate: false };
    });

    const outcomes = await processBatchJobs([
      job({ jobId: 'good-1' }),
      job({ jobId: 'bad' }),
      job({ jobId: 'good-2' }),
    ]);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.filter((o) => o.status === 'submitted')).toHaveLength(2);
    expect(outcomes.filter((o) => o.status === 'failed')).toHaveLength(1);
  });

  it('never runs more than the concurrency limit at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockedSubmitImportJob.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { jobId: 'j', recipeId: 'r', duplicate: false };
    });

    const jobs = Array.from({ length: 8 }, (_, i) => job({ jobId: `j${i}` }));
    await processBatchJobs(jobs);

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(mockedSubmitImportJob).toHaveBeenCalledTimes(8);
  });

  it('returns an empty array when every job is already terminal', async () => {
    const outcomes = await processBatchJobs([job({ status: 'complete' })]);
    expect(outcomes).toEqual([]);
    expect(mockedSubmitImportJob).not.toHaveBeenCalled();
  });
});
