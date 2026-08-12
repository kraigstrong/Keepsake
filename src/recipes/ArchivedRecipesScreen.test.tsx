import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import { ArchivedRecipesScreen } from './ArchivedRecipesScreen';
import { ToastProvider } from '../components/Toast';

function renderScreen() {
  return render(
    <ToastProvider>
      <ArchivedRecipesScreen />
    </ToastProvider>,
  );
}

jest.mock('./api');
// Same approximation as RecipeDetailScreen.test.tsx: only re-invokes on a
// new callback identity, not on every focus event a real device would fire.
let mockLastFocusEffect: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn((effect: () => void) => {
    if (effect !== mockLastFocusEffect) {
      mockLastFocusEffect = effect;
      effect();
    }
  }),
}));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedUseRouter = useRouter as jest.Mock;

const push = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockLastFocusEffect = null;
  mockedUseRouter.mockReturnValue({ push });
});

it('shows a loading state, then the archived recipes', async () => {
  mockedApi.fetchArchivedRecipes.mockResolvedValue([
    { id: 'r1', title: 'Chili', archivedAt: '2026-08-10T00:00:00.000Z' },
    { id: 'r2', title: 'Tacos', archivedAt: '2026-08-01T00:00:00.000Z' },
  ]);

  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('archived-recipes-list')).toBeTruthy());
  expect(screen.getByText('Chili')).toBeTruthy();
  expect(screen.getByText('Tacos')).toBeTruthy();
});

it('shows an empty state when there are no archived recipes', async () => {
  mockedApi.fetchArchivedRecipes.mockResolvedValue([]);

  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('archived-recipes-empty')).toBeTruthy());
});

it('shows an error state with retry when the load fails', async () => {
  mockedApi.fetchArchivedRecipes.mockRejectedValueOnce(new Error('offline'));

  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('archived-recipes-load-error')).toBeTruthy());

  mockedApi.fetchArchivedRecipes.mockResolvedValueOnce([
    { id: 'r1', title: 'Chili', archivedAt: '2026-08-10T00:00:00.000Z' },
  ]);
  await fireEvent.press(screen.getByText('Try again'));

  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
});

it('navigates to Recipe Detail when a row is pressed (ADR-0025 decision 5)', async () => {
  mockedApi.fetchArchivedRecipes.mockResolvedValue([
    { id: 'r1', title: 'Chili', archivedAt: '2026-08-10T00:00:00.000Z' },
  ]);

  await renderScreen();
  await waitFor(() => expect(screen.getByTestId('archived-recipe-r1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('archived-recipe-r1'));

  expect(push).toHaveBeenCalledWith('/recipe/r1');
});

it('unarchives a recipe and removes it from the list', async () => {
  mockedApi.fetchArchivedRecipes.mockResolvedValue([
    { id: 'r1', title: 'Chili', archivedAt: '2026-08-10T00:00:00.000Z' },
    { id: 'r2', title: 'Tacos', archivedAt: '2026-08-01T00:00:00.000Z' },
  ]);
  mockedApi.unarchiveRecipe.mockResolvedValue(undefined);

  await renderScreen();
  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('archived-recipe-unarchive-r1'));

  await waitFor(() => expect(mockedApi.unarchiveRecipe).toHaveBeenCalledWith('r1'));
  expect(screen.getByText('Recipe unarchived')).toBeTruthy();
  expect(screen.queryByText('Chili')).toBeNull();
  expect(screen.getByText('Tacos')).toBeTruthy();
});

it('shows an error toast and keeps the recipe listed when unarchiving fails', async () => {
  mockedApi.fetchArchivedRecipes.mockResolvedValue([
    { id: 'r1', title: 'Chili', archivedAt: '2026-08-10T00:00:00.000Z' },
  ]);
  mockedApi.unarchiveRecipe.mockRejectedValue(new Error('offline'));

  await renderScreen();
  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('archived-recipe-unarchive-r1'));

  await waitFor(() => expect(screen.getByText("Couldn't unarchive recipe")).toBeTruthy());
  expect(screen.getByText('Chili')).toBeTruthy();
});
