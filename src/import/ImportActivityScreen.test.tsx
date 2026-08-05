import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import * as batchEngine from './batchEngine';
import { ImportActivityScreen } from './ImportActivityScreen';

jest.mock('./api');
jest.mock('./batchEngine');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedBatchEngine = batchEngine as jest.Mocked<typeof batchEngine>;
const mockedUseRouter = useRouter as jest.Mock;
const push = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push });
  mockedBatchEngine.processBatchJobs.mockResolvedValue([]);
});

describe('ImportActivityScreen', () => {
  it('shows a loading state before the batch loads', async () => {
    mockedApi.fetchBatchJobs.mockReturnValue(new Promise(() => {})); // never resolves
    await render(<ImportActivityScreen batchId="b1" />);
    expect(screen.getByTestId('import-activity-loading')).toBeTruthy();
  });

  it('renders every job with its URL and status once loaded', async () => {
    mockedApi.fetchBatchJobs.mockResolvedValue([
      { batchId: 'b1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'complete' },
      { batchId: 'b1', jobId: 'j2', sourceUrl: 'https://example.com/b', status: 'failed' },
    ]);

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(screen.getByText('https://example.com/a')).toBeTruthy();
    });
    expect(screen.getByText('https://example.com/b')).toBeTruthy();
    expect(screen.getByText('Imported')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('shows the specific error message for a failed job when one is stored', async () => {
    mockedApi.fetchBatchJobs.mockResolvedValue([
      {
        batchId: 'b1',
        jobId: 'j1',
        sourceUrl: 'https://example.com/a',
        status: 'failed',
        errorMessage: 'Could not find enough recipe content on this page',
      },
    ]);

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(screen.getByText('Could not find enough recipe content on this page')).toBeTruthy();
    });
  });

  it('labels a duplicate outcome distinctly from a fresh import', async () => {
    mockedApi.fetchBatchJobs.mockResolvedValue([
      {
        batchId: 'b1',
        jobId: 'j1',
        sourceUrl: 'https://example.com/a',
        status: 'complete',
        recipeId: 'r1',
        duplicate: true,
      },
    ]);

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(screen.getByText('Already in your library')).toBeTruthy();
    });
  });

  it('fires processing for the fetched jobs on mount', async () => {
    const jobs: api.BatchJobStub[] = [
      { batchId: 'b1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'processing' },
    ];
    mockedApi.fetchBatchJobs.mockResolvedValue(jobs);

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(mockedBatchEngine.processBatchJobs).toHaveBeenCalledWith(jobs);
    });
  });

  it('shows in-progress vs done summary counts', async () => {
    mockedApi.fetchBatchJobs.mockResolvedValue([
      { batchId: 'b1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'complete' },
      { batchId: 'b1', jobId: 'j2', sourceUrl: 'https://example.com/b', status: 'processing' },
      { batchId: 'b1', jobId: 'j3', sourceUrl: 'https://example.com/c', status: 'processing' },
    ]);

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(screen.getByTestId('import-activity-summary')).toHaveTextContent('1 of 3 done');
    });
  });

  it('shows a final summary with failure count once every job is terminal', async () => {
    mockedApi.fetchBatchJobs.mockResolvedValue([
      { batchId: 'b1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'complete' },
      { batchId: 'b1', jobId: 'j2', sourceUrl: 'https://example.com/b', status: 'failed' },
    ]);

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(screen.getByTestId('import-activity-summary')).toHaveTextContent(
        '1 imported, 1 failed',
      );
    });
  });

  it('polls for updated status while any job is still processing, and stops once done', async () => {
    mockedApi.fetchBatchJobs
      .mockResolvedValueOnce([
        { batchId: 'b1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'processing' },
      ])
      .mockResolvedValueOnce([
        { batchId: 'b1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'complete' },
      ]);

    await render(<ImportActivityScreen batchId="b1" pollIntervalMs={10} />);

    await waitFor(() => {
      expect(screen.getByText('Imported')).toBeTruthy();
    });
    expect(mockedApi.fetchBatchJobs).toHaveBeenCalledTimes(2);

    // No further polling once every job is terminal.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockedApi.fetchBatchJobs).toHaveBeenCalledTimes(2);
  });

  it('navigates to the recipe when a completed row is pressed', async () => {
    mockedApi.fetchBatchJobs.mockResolvedValue([
      {
        batchId: 'b1',
        jobId: 'j1',
        sourceUrl: 'https://example.com/a',
        status: 'complete',
        recipeId: 'r1',
      },
    ]);

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(screen.getByTestId('import-activity-row-j1-open')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('import-activity-row-j1-open'));

    expect(push).toHaveBeenCalledWith('/recipe/r1');
  });

  it('shows an error state when the batch fails to load', async () => {
    mockedApi.fetchBatchJobs.mockRejectedValue(new Error('Network request failed'));

    await render(<ImportActivityScreen batchId="b1" />);

    await waitFor(() => {
      expect(screen.getByText('Network request failed')).toBeTruthy();
    });
  });
});
