import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import * as api from './api';
import { RecentlyDeletedScreen } from './RecentlyDeletedScreen';
import { confirm } from '../components/confirm';
import { ToastProvider } from '../components/Toast';

function renderScreen() {
  return render(
    <ToastProvider>
      <RecentlyDeletedScreen />
    </ToastProvider>,
  );
}

jest.mock('./api');
jest.mock('../components/confirm');
// Same approximation as RecipeDetailScreen.test.tsx: only re-invokes on a
// new callback identity, not on every focus event a real device would fire.
let mockLastFocusEffect: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn((effect: () => void) => {
    if (effect !== mockLastFocusEffect) {
      mockLastFocusEffect = effect;
      effect();
    }
  }),
}));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedConfirm = confirm as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockLastFocusEffect = null;
});

it('shows a loading state, then the deleted recipes', async () => {
  mockedApi.fetchDeletedRecipes.mockResolvedValue([
    { id: 'r1', title: 'Chili', deletedAt: '2026-08-10T00:00:00.000Z' },
    { id: 'r2', title: 'Tacos', deletedAt: '2026-08-01T00:00:00.000Z' },
  ]);

  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('recently-deleted-list')).toBeTruthy());
  expect(screen.getByText('Chili')).toBeTruthy();
  expect(screen.getByText('Tacos')).toBeTruthy();
});

it('shows an empty state when nothing is deleted', async () => {
  mockedApi.fetchDeletedRecipes.mockResolvedValue([]);

  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('recently-deleted-empty')).toBeTruthy());
});

it('shows an error state with retry when the load fails', async () => {
  mockedApi.fetchDeletedRecipes.mockRejectedValueOnce(new Error('offline'));

  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('recently-deleted-load-error')).toBeTruthy());

  mockedApi.fetchDeletedRecipes.mockResolvedValueOnce([
    { id: 'r1', title: 'Chili', deletedAt: '2026-08-10T00:00:00.000Z' },
  ]);
  await fireEvent.press(screen.getByText('Try again'));

  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
});

describe('restore', () => {
  it('restores a recipe and removes it from the list, without confirmation', async () => {
    mockedApi.fetchDeletedRecipes.mockResolvedValue([
      { id: 'r1', title: 'Chili', deletedAt: '2026-08-10T00:00:00.000Z' },
      { id: 'r2', title: 'Tacos', deletedAt: '2026-08-01T00:00:00.000Z' },
    ]);
    mockedApi.restoreRecipe.mockResolvedValue(undefined);

    await renderScreen();
    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('recently-deleted-restore-r1'));

    await waitFor(() => expect(mockedApi.restoreRecipe).toHaveBeenCalledWith('r1'));
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Recipe restored')).toBeTruthy();
    expect(screen.queryByText('Chili')).toBeNull();
    expect(screen.getByText('Tacos')).toBeTruthy();
  });

  it('shows an error toast and keeps the recipe listed when restoring fails', async () => {
    mockedApi.fetchDeletedRecipes.mockResolvedValue([
      { id: 'r1', title: 'Chili', deletedAt: '2026-08-10T00:00:00.000Z' },
    ]);
    mockedApi.restoreRecipe.mockRejectedValue(new Error('offline'));

    await renderScreen();
    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('recently-deleted-restore-r1'));

    await waitFor(() => expect(screen.getByText("Couldn't restore recipe")).toBeTruthy());
    expect(screen.getByText('Chili')).toBeTruthy();
  });
});

describe('permanently delete (LIFE-07, ADR-0025 decision 9)', () => {
  it('does nothing when the confirmation is declined', async () => {
    mockedApi.fetchDeletedRecipes.mockResolvedValue([
      { id: 'r1', title: 'Chili', deletedAt: '2026-08-10T00:00:00.000Z' },
    ]);
    mockedConfirm.mockResolvedValue(false);

    await renderScreen();
    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('recently-deleted-permanently-delete-r1'));

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalled());
    expect(mockedApi.permanentlyDeleteRecipe).not.toHaveBeenCalled();
    expect(screen.getByText('Chili')).toBeTruthy();
  });

  it('permanently deletes the recipe and removes it from the list after confirming', async () => {
    mockedApi.fetchDeletedRecipes.mockResolvedValue([
      { id: 'r1', title: 'Chili', deletedAt: '2026-08-10T00:00:00.000Z' },
    ]);
    mockedConfirm.mockResolvedValue(true);
    mockedApi.permanentlyDeleteRecipe.mockResolvedValue(undefined);

    await renderScreen();
    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('recently-deleted-permanently-delete-r1'));

    await waitFor(() => expect(mockedApi.permanentlyDeleteRecipe).toHaveBeenCalledWith('r1'));
    expect(screen.getByText('Recipe permanently deleted')).toBeTruthy();
    expect(screen.queryByText('Chili')).toBeNull();
  });

  it('shows an error toast and keeps the recipe listed when it fails after confirming', async () => {
    mockedApi.fetchDeletedRecipes.mockResolvedValue([
      { id: 'r1', title: 'Chili', deletedAt: '2026-08-10T00:00:00.000Z' },
    ]);
    mockedConfirm.mockResolvedValue(true);
    mockedApi.permanentlyDeleteRecipe.mockRejectedValue(new Error('recipe is not deleted'));

    await renderScreen();
    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('recently-deleted-permanently-delete-r1'));

    await waitFor(() =>
      expect(screen.getByText("Couldn't permanently delete recipe")).toBeTruthy(),
    );
    expect(screen.getByText('Chili')).toBeTruthy();
  });
});
