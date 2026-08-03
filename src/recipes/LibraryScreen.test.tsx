import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { LibraryScreen } from './LibraryScreen';
import { useHousehold } from '../household/HouseholdProvider';
import { readLocalRecipeSummaries } from '../sync/offlineRecipes';
import { syncHousehold } from '../sync/syncEngine';

jest.mock('../sync/offlineRecipes');
jest.mock('../sync/syncEngine');
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  // useFocusEffect normally only re-runs on navigation focus events —
  // this test suite isn't inside a real navigator, so it's mocked to
  // behave like a plain mount-time effect instead.
  useFocusEffect: jest.fn((effect: () => void) => effect()),
}));
// Transitively pulled in by ../sync/syncEngine's real module shape and
// ../supabase/instance — mocked so loading it doesn't trip the
// missing-env-var throw or touch native modules.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedReadLocalRecipeSummaries = readLocalRecipeSummaries as jest.Mock;
const mockedSyncHousehold = syncHousehold as jest.Mock;
const mockedUseHousehold = useHousehold as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseFocusEffect = useFocusEffect as jest.Mock;

const push = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push });
  mockedUseFocusEffect.mockImplementation((effect: () => void) => effect());
  mockedUseHousehold.mockReturnValue({ household: { id: 'h1' } });
  mockedSyncHousehold.mockResolvedValue(undefined);
});

it('shows an empty state with an add action when there are no local recipes', async () => {
  mockedReadLocalRecipeSummaries.mockResolvedValue([]);

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());

  await fireEvent.press(screen.getByText('Add a recipe'));
  expect(push).toHaveBeenCalledWith('/recipe/new');
});

it('lists recipes from the local cache and navigates to a recipe on press', async () => {
  mockedReadLocalRecipeSummaries.mockResolvedValue([
    { id: 'r1', title: 'Chili' },
    { id: 'r2', title: 'Tacos' },
  ]);

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
  expect(screen.getByText('Tacos')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('library-recipe-r1'));
  expect(push).toHaveBeenCalledWith('/recipe/r1');
});

it('shows an error state when the local read itself fails', async () => {
  mockedReadLocalRecipeSummaries.mockRejectedValue(new Error('disk error'));

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByTestId('library-load-error')).toBeTruthy());
});

it('syncs in the background without surfacing an error when the sync itself fails', async () => {
  mockedReadLocalRecipeSummaries.mockResolvedValue([{ id: 'r1', title: 'Chili' }]);
  mockedSyncHousehold.mockRejectedValue(new Error('offline'));

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
  expect(screen.queryByTestId('library-load-error')).toBeNull();
  await waitFor(() => expect(mockedSyncHousehold).toHaveBeenCalledWith('h1'));
});

it('does not attempt to sync when there is no household yet', async () => {
  mockedUseHousehold.mockReturnValue({ household: null });
  mockedReadLocalRecipeSummaries.mockResolvedValue([]);

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());
  expect(mockedSyncHousehold).not.toHaveBeenCalled();
});
