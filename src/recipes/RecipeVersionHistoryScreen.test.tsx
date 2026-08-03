import { fireEvent, render, screen } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import { RecipeVersionHistoryScreen } from './RecipeVersionHistoryScreen';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedUseRouter = useRouter as jest.Mock;

const replace = jest.fn();

const versions: api.RecipeVersionSummary[] = [
  { id: 'v3', versionNumber: 3, createdAt: '2026-08-03T12:00:00Z' },
  { id: 'v2', versionNumber: 2, createdAt: '2026-08-02T12:00:00Z' },
  { id: 'v1', versionNumber: 1, createdAt: '2026-08-01T12:00:00Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ replace });
});

it('lists versions newest-first, without a restore action on the newest', async () => {
  mockedApi.fetchRecipeVersions.mockResolvedValue(versions);

  await render(<RecipeVersionHistoryScreen recipeId="recipe-1" />);

  expect(screen.getByText('Version 3')).toBeTruthy();
  expect(screen.getByText('Version 2')).toBeTruthy();
  expect(screen.getByText('Version 1')).toBeTruthy();
  expect(screen.queryByTestId('recipe-history-restore-v3')).toBeNull();
  expect(screen.getByTestId('recipe-history-restore-v2')).toBeTruthy();
  expect(screen.getByTestId('recipe-history-restore-v1')).toBeTruthy();
});

it('shows an error state when versions fail to load', async () => {
  mockedApi.fetchRecipeVersions.mockRejectedValue(new Error('boom'));

  await render(<RecipeVersionHistoryScreen recipeId="recipe-1" />);

  expect(screen.getByTestId('recipe-history-load-error')).toBeTruthy();
});

it('restores a version and navigates to the recipe detail screen', async () => {
  mockedApi.fetchRecipeVersions.mockResolvedValue(versions);
  mockedApi.restoreRecipeVersion.mockResolvedValue({ id: 'recipe-1' });

  await render(<RecipeVersionHistoryScreen recipeId="recipe-1" />);

  await fireEvent.press(screen.getByTestId('recipe-history-restore-v1'));

  expect(mockedApi.restoreRecipeVersion).toHaveBeenCalledWith('v1');
  expect(replace).toHaveBeenCalledWith('/recipe/recipe-1');
});

it('shows an error and stays put when restoring fails', async () => {
  mockedApi.fetchRecipeVersions.mockResolvedValue(versions);
  mockedApi.restoreRecipeVersion.mockRejectedValue(new Error('boom'));

  await render(<RecipeVersionHistoryScreen recipeId="recipe-1" />);

  await fireEvent.press(screen.getByTestId('recipe-history-restore-v1'));

  expect(screen.getByTestId('recipe-history-error')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});
