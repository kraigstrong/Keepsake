import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import { ImportRecipeScreen } from './ImportRecipeScreen';

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

describe('ImportRecipeScreen', () => {
  it('disables Import until a URL is entered', async () => {
    await render(<ImportRecipeScreen />);
    expect(screen.getByTestId('import-url-submit')).toBeDisabled();

    await fireEvent.changeText(
      screen.getByTestId('import-url-input'),
      'https://example.com/recipe',
    );
    expect(screen.getByTestId('import-url-submit')).not.toBeDisabled();
  });

  it('imports the URL and navigates to the resulting recipe', async () => {
    mockedApi.importRecipeFromUrl.mockResolvedValue({
      jobId: 'job-1',
      recipeId: 'recipe-1',
      duplicate: false,
      uncertainFields: [],
    });

    await render(<ImportRecipeScreen />);
    await fireEvent.changeText(
      screen.getByTestId('import-url-input'),
      'https://example.com/recipe',
    );
    await fireEvent.press(screen.getByTestId('import-url-submit'));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/recipe/recipe-1?imported=1');
    });
    expect(mockedApi.importRecipeFromUrl).toHaveBeenCalledWith('https://example.com/recipe');
  });

  it('shows a loading state while the import is in flight', async () => {
    mockedApi.importRecipeFromUrl.mockReturnValue(new Promise(() => {})); // never resolves

    await render(<ImportRecipeScreen />);
    await fireEvent.changeText(
      screen.getByTestId('import-url-input'),
      'https://example.com/recipe',
    );
    fireEvent.press(screen.getByTestId('import-url-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('import-recipe-loading')).toBeTruthy();
    });
  });

  it('navigates to the existing recipe when the import resolves to a duplicate', async () => {
    mockedApi.importRecipeFromUrl.mockResolvedValue({
      jobId: 'job-1',
      recipeId: 'existing-recipe',
      duplicate: true,
      uncertainFields: [],
    });

    await render(<ImportRecipeScreen />);
    await fireEvent.changeText(
      screen.getByTestId('import-url-input'),
      'https://example.com/recipe',
    );
    await fireEvent.press(screen.getByTestId('import-url-submit'));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/recipe/existing-recipe?imported=1&duplicate=1');
    });
  });

  it('shows an error and lets the user retry when the import fails', async () => {
    mockedApi.importRecipeFromUrl.mockRejectedValue(
      new Error('Could not find enough recipe content on this page'),
    );

    await render(<ImportRecipeScreen />);
    await fireEvent.changeText(
      screen.getByTestId('import-url-input'),
      'https://example.com/recipe',
    );
    await fireEvent.press(screen.getByTestId('import-url-submit'));

    await waitFor(() => {
      expect(screen.getByText('Could not find enough recipe content on this page')).toBeTruthy();
    });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('import-url-submit')).not.toBeDisabled();
  });

  it('trims whitespace from the entered URL before submitting', async () => {
    mockedApi.importRecipeFromUrl.mockResolvedValue({
      jobId: 'job-1',
      recipeId: 'recipe-1',
      duplicate: false,
      uncertainFields: [],
    });

    await render(<ImportRecipeScreen />);
    await fireEvent.changeText(
      screen.getByTestId('import-url-input'),
      '  https://example.com/recipe  ',
    );
    await fireEvent.press(screen.getByTestId('import-url-submit'));

    await waitFor(() => {
      expect(mockedApi.importRecipeFromUrl).toHaveBeenCalledWith('https://example.com/recipe');
    });
  });
});
