import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
// Jest's module-factory hoisting only allows referencing out-of-scope
// identifiers prefixed "mock" (case-insensitive) — see the Link stand-in
// inside jest.mock('expo-router', ...) below.
import { Text as MockText } from 'react-native';

import { LibraryScreen } from './LibraryScreen';
import type { LibraryRecipe } from '../sync/offlineRecipes';
import { useAddSheet } from '../components/AddSheetContext';
import { useHousehold } from '../household/HouseholdProvider';
import { useImportActivity } from '../import/ImportActivityContext';
import { searchRecipes } from '../search/search';
import { readLocalCategories, readLocalLibraryRecipes } from '../sync/offlineRecipes';
import { syncHousehold } from '../sync/syncEngine';

jest.mock('../sync/offlineRecipes');
jest.mock('../sync/syncEngine');
jest.mock('../search/search');
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('../components/AddSheetContext', () => ({ useAddSheet: jest.fn() }));
jest.mock('../import/ImportActivityContext', () => ({ useImportActivity: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  // useFocusEffect normally only re-runs on navigation focus events —
  // this test suite isn't inside a real navigator, so it's mocked to
  // behave like a plain mount-time effect instead.
  useFocusEffect: jest.fn((effect: () => void) => effect()),
  // ScreenHeader uses expo-router's real Link for the Settings icon —
  // this mock replaces the whole module, so Link needs a stand-in too
  // or it renders as undefined.
  Link: ({ children, ...props }: { children: ReactNode }) => (
    <MockText {...props}>{children}</MockText>
  ),
}));
// Transitively pulled in by ../sync/syncEngine's real module shape and
// ../supabase/instance — mocked so loading it doesn't trip the
// missing-env-var throw or touch native modules.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

function recipe(overrides: Partial<LibraryRecipe> = {}): LibraryRecipe {
  return {
    id: overrides.id ?? 'r1',
    title: 'Chili',
    createdAt: '2020-01-01T00:00:00.000Z',
    categoryIds: [],
    tags: [],
    plannedCount: 0,
    ...overrides,
  };
}

const mockedReadLocalLibraryRecipes = readLocalLibraryRecipes as jest.Mock;
const mockedReadLocalCategories = readLocalCategories as jest.Mock;
const mockedSearchRecipes = searchRecipes as jest.Mock;
const mockedSyncHousehold = syncHousehold as jest.Mock;
const mockedUseHousehold = useHousehold as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseFocusEffect = useFocusEffect as jest.Mock;
const mockedUseAddSheet = useAddSheet as jest.Mock;
const mockedUseImportActivity = useImportActivity as jest.Mock;

const push = jest.fn();
const openAddSheet = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push });
  mockedUseFocusEffect.mockImplementation((effect: () => void) => effect());
  mockedUseHousehold.mockReturnValue({ household: { id: 'h1' } });
  mockedSyncHousehold.mockResolvedValue(undefined);
  mockedUseAddSheet.mockReturnValue({ open: openAddSheet, close: jest.fn(), isVisible: false });
  mockedUseImportActivity.mockReturnValue({ version: 0, notifyImportCompleted: jest.fn() });
  mockedReadLocalCategories.mockResolvedValue([]);
  mockedSearchRecipes.mockResolvedValue([]);
});

it('shows an empty state whose add action opens the shared add sheet, not manual create directly', async () => {
  mockedReadLocalLibraryRecipes.mockResolvedValue([]);

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());

  await fireEvent.press(screen.getByText('Add a recipe'));
  expect(openAddSheet).toHaveBeenCalled();
  expect(push).not.toHaveBeenCalledWith('/recipe/new');
});

it('lists recipes from the local cache and navigates to a recipe on press', async () => {
  mockedReadLocalLibraryRecipes.mockResolvedValue([
    recipe({ id: 'r1', title: 'Chili' }),
    recipe({ id: 'r2', title: 'Tacos' }),
  ]);

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
  expect(screen.getByText('Tacos')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('library-recipe-r1'));
  expect(push).toHaveBeenCalledWith('/recipe/r1');
});

it('shows an error state when the local read itself fails', async () => {
  mockedReadLocalLibraryRecipes.mockRejectedValue(new Error('disk error'));

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByTestId('library-load-error')).toBeTruthy());
});

it('syncs in the background without surfacing an error when the sync itself fails', async () => {
  mockedReadLocalLibraryRecipes.mockResolvedValue([recipe({ id: 'r1', title: 'Chili' })]);
  mockedSyncHousehold.mockRejectedValue(new Error('offline'));

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
  expect(screen.queryByTestId('library-load-error')).toBeNull();
  await waitFor(() => expect(mockedSyncHousehold).toHaveBeenCalledWith('h1'));
});

it('does not read local data or attempt to sync when there is no household yet (ADR-0020: local reads are household-scoped)', async () => {
  mockedUseHousehold.mockReturnValue({ household: null });
  mockedReadLocalLibraryRecipes.mockResolvedValue([]);

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByTestId('library-loading')).toBeTruthy());
  expect(mockedReadLocalLibraryRecipes).not.toHaveBeenCalled();
  expect(mockedSyncHousehold).not.toHaveBeenCalled();
});

describe('sorting', () => {
  it('defaults to Smart sort and orders recently-added recipes first', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([
      recipe({ id: 'old', title: 'Aardvark Stew', createdAt: '2020-01-01T00:00:00.000Z' }),
      recipe({ id: 'new', title: 'Zucchini Bread', createdAt: new Date().toISOString() }),
    ]);

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-recipe-list')).toBeTruthy());

    const list = screen.getByTestId('library-recipe-list');
    expect(list.props.data.map((r: LibraryRecipe) => r.id)).toEqual(['new', 'old']);
  });

  it('switches to alphabetical ordering when that chip is selected', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([
      recipe({ id: 'r1', title: 'Tacos' }),
      recipe({ id: 'r2', title: 'Chili' }),
    ]);

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-sort-alphabetical')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('library-sort-alphabetical'));

    const list = screen.getByTestId('library-recipe-list');
    expect(list.props.data.map((r: LibraryRecipe) => r.id)).toEqual(['r2', 'r1']);
  });
});

describe('filters', () => {
  it('shows the active filter count on the Filters chip and narrows the list', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([
      recipe({ id: 'chicken', title: 'Chicken Soup', categoryIds: ['cat-chicken'] }),
      recipe({ id: 'beef', title: 'Beef Stew', categoryIds: ['cat-beef'] }),
    ]);
    mockedReadLocalCategories.mockResolvedValue([
      { id: 'cat-chicken', groupName: 'protein', value: 'Chicken' },
      { id: 'cat-beef', groupName: 'protein', value: 'Beef' },
    ]);

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-filter-button')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('library-filter-button'));
    await waitFor(() =>
      expect(screen.getByTestId('library-filter-category-cat-chicken')).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId('library-filter-category-cat-chicken'));

    expect(screen.getByText('Filters (1)')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('library-filter-done'));
    const list = screen.getByTestId('library-recipe-list');
    expect(list.props.data.map((r: LibraryRecipe) => r.id)).toEqual(['chicken']);
  });

  it('shows a distinct empty state, with a clear action, when filters exclude everything', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([
      recipe({ id: 'chicken', title: 'Chicken Soup', categoryIds: ['cat-chicken'] }),
    ]);
    mockedReadLocalCategories.mockResolvedValue([
      { id: 'cat-chicken', groupName: 'protein', value: 'Chicken' },
      { id: 'cat-beef', groupName: 'protein', value: 'Beef' },
    ]);

    await render(<LibraryScreen />);
    await fireEvent.press(await screen.findByTestId('library-filter-button'));
    await fireEvent.press(await screen.findByTestId('library-filter-category-cat-beef'));
    await fireEvent.press(screen.getByTestId('library-filter-done'));

    await waitFor(() => expect(screen.getByTestId('library-filtered-empty')).toBeTruthy());

    await fireEvent.press(screen.getByText('Clear filters'));
    await waitFor(() => expect(screen.getByTestId('library-recipe-list')).toBeTruthy());
  });
});

describe('search', () => {
  it('shows search results (title only) instead of the sorted/filtered list once a query is typed', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([recipe({ id: 'r1', title: 'Chili' })]);
    mockedSearchRecipes.mockResolvedValue([{ id: 'r9', title: 'Chicken Tikka' }]);

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-search-input')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('library-search-input'), 'chick');

    await waitFor(() => expect(mockedSearchRecipes).toHaveBeenCalledWith('chick', 'h1'), {
      timeout: 2000,
    });
    await waitFor(() => expect(screen.getByText('Chicken Tikka')).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText('Chili')).toBeNull();
  }, 10000);

  it('shows a distinct empty state for a search with no matches', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([recipe({ id: 'r1', title: 'Chili' })]);
    mockedSearchRecipes.mockResolvedValue([]);

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-search-input')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('library-search-input'), 'nonexistent');

    await waitFor(() => expect(screen.getByTestId('library-search-empty')).toBeTruthy(), {
      timeout: 2000,
    });
  }, 10000);

  it('restores the sorted/filtered list once the search query is cleared', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([recipe({ id: 'r1', title: 'Chili' })]);
    mockedSearchRecipes.mockResolvedValue([{ id: 'r9', title: 'Chicken Tikka' }]);

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-search-input')).toBeTruthy());
    const input = screen.getByTestId('library-search-input');

    fireEvent.changeText(input, 'chick');
    await waitFor(() => expect(screen.getByText('Chicken Tikka')).toBeTruthy(), { timeout: 2000 });

    fireEvent.changeText(input, '');
    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
  }, 10000);
});

it('preserves search text and filters across a focus-triggered reload (search-state restoration)', async () => {
  mockedReadLocalLibraryRecipes.mockResolvedValue([recipe({ id: 'r1', title: 'Chili' })]);

  await render(<LibraryScreen />);
  const input = await screen.findByTestId('library-search-input');
  fireEvent.changeText(input, 'chicken');

  // Simulate the focus effect firing again (e.g. returning to this tab)
  // without unmounting — the reload must not clear what was typed.
  mockedUseFocusEffect.mock.calls[0]![0]();

  await waitFor(() => expect(input.props.value).toBe('chicken'));
});
