import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import { BulkImportRecipesScreen } from './BulkImportRecipesScreen';
import { MAX_BULK_IMPORT_URLS } from './parseBulkUrls';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedUseRouter = useRouter as jest.Mock;
const replace = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ replace });
});

describe('BulkImportRecipesScreen', () => {
  it('disables Import all until at least one URL is pasted', async () => {
    await render(<BulkImportRecipesScreen />);
    expect(screen.getByTestId('bulk-import-submit')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('bulk-import-input'), 'https://example.com/a');
    expect(screen.getByTestId('bulk-import-submit')).not.toBeDisabled();
  });

  it('shows a running count of recognized links as the user types', async () => {
    await render(<BulkImportRecipesScreen />);
    expect(screen.getByTestId('bulk-import-count')).toHaveTextContent('No links found yet');

    await fireEvent.changeText(
      screen.getByTestId('bulk-import-input'),
      'https://example.com/a\nhttps://example.com/b',
    );
    expect(screen.getByTestId('bulk-import-count')).toHaveTextContent('2 links found');
  });

  it('disables submission and shows a message when more than the max is pasted', async () => {
    const tooMany = Array.from(
      { length: MAX_BULK_IMPORT_URLS + 1 },
      (_, i) => `https://example.com/${i}`,
    ).join('\n');

    await render(<BulkImportRecipesScreen />);
    await fireEvent.changeText(screen.getByTestId('bulk-import-input'), tooMany);

    expect(screen.getByTestId('bulk-import-submit')).toBeDisabled();
    expect(screen.getByText(/please paste 20 or fewer at a time/)).toBeTruthy();
  });

  it('reserves the batch and navigates to the Import Activity screen', async () => {
    mockedApi.createImportBatch.mockResolvedValue([
      { batchId: 'batch-1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'processing' },
      { batchId: 'batch-1', jobId: 'j2', sourceUrl: 'https://example.com/b', status: 'processing' },
    ]);

    await render(<BulkImportRecipesScreen />);
    await fireEvent.changeText(
      screen.getByTestId('bulk-import-input'),
      'https://example.com/a\nhttps://example.com/b',
    );
    await fireEvent.press(screen.getByTestId('bulk-import-submit'));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/recipe/import-batch/batch-1');
    });
    expect(mockedApi.createImportBatch).toHaveBeenCalledWith([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('shows a loading state while the batch is being reserved', async () => {
    mockedApi.createImportBatch.mockReturnValue(new Promise(() => {})); // never resolves

    await render(<BulkImportRecipesScreen />);
    await fireEvent.changeText(screen.getByTestId('bulk-import-input'), 'https://example.com/a');
    fireEvent.press(screen.getByTestId('bulk-import-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-import-loading')).toBeTruthy();
    });
  });

  it('shows an error and lets the user retry when reserving the batch fails', async () => {
    mockedApi.createImportBatch.mockRejectedValue(
      new Error("this batch would exceed the household's hourly import limit"),
    );

    await render(<BulkImportRecipesScreen />);
    await fireEvent.changeText(screen.getByTestId('bulk-import-input'), 'https://example.com/a');
    await fireEvent.press(screen.getByTestId('bulk-import-submit'));

    await waitFor(() => {
      expect(
        screen.getByText("this batch would exceed the household's hourly import limit"),
      ).toBeTruthy();
    });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('bulk-import-submit')).not.toBeDisabled();
  });
});
