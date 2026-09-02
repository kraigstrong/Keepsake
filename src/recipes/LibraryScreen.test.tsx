import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
import { trackEvent } from '../observability';
import { seedStarterRecipes } from '../starterRecipes/api';
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
jest.mock('../starterRecipes/api', () => ({ seedStarterRecipes: jest.fn() }));
jest.mock('../observability', () => ({ trackEvent: jest.fn() }));

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
const mockedSeedStarterRecipes = seedStarterRecipes as jest.Mock;
const mockedTrackEvent = trackEvent as jest.Mock;

const push = jest.fn();
const openAddSheet = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push });
  mockedUseFocusEffect.mockImplementation((effect: () => void) => effect());
  mockedUseHousehold.mockReturnValue({
    household: { id: 'h1', starterRecipesSeededAt: null },
    refreshHousehold: jest.fn(() => Promise.resolve()),
  });
  mockedSyncHousehold.mockResolvedValue(undefined);
  mockedUseAddSheet.mockReturnValue({ open: openAddSheet, close: jest.fn(), isVisible: false });
  mockedUseImportActivity.mockReturnValue({ version: 0, notifyImportCompleted: jest.fn() });
  mockedReadLocalCategories.mockResolvedValue([]);
  mockedSearchRecipes.mockResolvedValue([]);
  mockedSeedStarterRecipes.mockResolvedValue({ seeded: true, recipeCount: 10 });
});

it('shows the plain empty state, whose add action opens the shared add sheet, once the household has seeded', async () => {
  mockedUseHousehold.mockReturnValue({
    household: { id: 'h1', starterRecipesSeededAt: '2026-09-01T00:00:00.000Z' },
    refreshHousehold: jest.fn(() => Promise.resolve()),
  });
  mockedReadLocalLibraryRecipes.mockResolvedValue([]);

  await render(<LibraryScreen />);

  await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());
  expect(screen.queryByTestId('library-starter-offer')).toBeNull();

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

describe('starter recipe offer', () => {
  it('offers the starter recipes on an empty library the household has never seeded', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());
    expect(screen.getByText('Start your Keepsake')).toBeTruthy();
    expect(screen.queryByTestId('library-placeholder')).toBeNull();
  });

  it('does not offer once the household has already seeded', async () => {
    // Otherwise a household that seeds and then archives or deletes all
    // ten is left tapping a button that can only ever no-op.
    mockedUseHousehold.mockReturnValue({
      household: { id: 'h1', starterRecipesSeededAt: '2026-09-01T00:00:00.000Z' },
      refreshHousehold: jest.fn(() => Promise.resolve()),
    });
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('library-starter-offer')).toBeNull();
  });

  it('does not offer before the first sync has settled', async () => {
    // A cold local mirror on an established household reads as empty.
    // The plain empty state is fine meanwhile; the offer is not.
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);
    mockedSyncHousehold.mockReturnValue(new Promise(() => {}));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('library-starter-offer')).toBeNull();
  });

  it('does not offer when the local read failed outright', async () => {
    mockedReadLocalLibraryRecipes.mockRejectedValue(new Error('disk error'));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('library-load-error')).toBeTruthy());
    expect(screen.queryByTestId('library-starter-offer')).toBeNull();
  });

  it('seeds and repaints the list when the offer is taken', async () => {
    // Keyed off whether the seed has run rather than a call count: the
    // focus effect reads local recipes more than once per render, so
    // counting calls makes this test depend on render bookkeeping.
    let hasSeeded = false;
    // Stable array instances, not fresh ones per call. The useFocusEffect
    // mock at the top of this file re-runs the effect on every render, so
    // a new array reference each time means setRecipes never reaches a
    // fixed point and the render loop never settles. A harness artifact,
    // not a product one -- the real useFocusEffect fires on focus only.
    const emptyLibrary: LibraryRecipe[] = [];
    const seededLibrary = [recipe({ id: 'r1', title: 'Weeknight Bolognese' })];
    mockedReadLocalLibraryRecipes.mockImplementation(() =>
      Promise.resolve(hasSeeded ? seededLibrary : emptyLibrary),
    );
    mockedSeedStarterRecipes.mockImplementation(() => {
      hasSeeded = true;
      return Promise.resolve({ seeded: true, recipeCount: 10 });
    });

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('library-starter-offer-action'));

    expect(mockedSeedStarterRecipes).toHaveBeenCalledWith('h1');
    await waitFor(() => expect(screen.getByText('Weeknight Bolognese')).toBeTruthy());
  });

  it('declining opens the add sheet and seeds nothing', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('library-starter-offer-secondary-action'));

    expect(openAddSheet).toHaveBeenCalled();
    expect(mockedSeedStarterRecipes).not.toHaveBeenCalled();
  });

  it('shows an inline error and leaves the offer usable when seeding fails', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);
    mockedSeedStarterRecipes.mockRejectedValue(new Error('offline'));

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('library-starter-offer-action'));

    await waitFor(() => expect(screen.getByTestId('library-starter-offer-error')).toBeTruthy());
    // Never a navigation away from the screen the user is standing on.
    expect(push).not.toHaveBeenCalled();
    // And still tappable for a retry.
    expect(screen.getByTestId('library-starter-offer-action')).toBeTruthy();
  });

  it('reports the offer once, not on every render', async () => {
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);

    const { rerender } = await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());
    await rerender(<LibraryScreen />);

    expect(
      mockedTrackEvent.mock.calls.filter(([n]) => n === 'starter_recipes_offered'),
    ).toHaveLength(1);
  });

  it('reports nothing when the offer never renders', async () => {
    mockedUseHousehold.mockReturnValue({
      household: { id: 'h1', starterRecipesSeededAt: '2026-09-01T00:00:00.000Z' },
      refreshHousehold: jest.fn(() => Promise.resolve()),
    });
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());
    expect(mockedTrackEvent).not.toHaveBeenCalledWith('starter_recipes_offered');
  });
});

// Re-fires the most recent useFocusEffect closure, the way returning to
// this tab does — the same trick the search-state-restoration test uses,
// but always taking the latest call so it closes over current state.
async function refireFocusEffect() {
  const calls = mockedUseFocusEffect.mock.calls;
  const latest = calls[calls.length - 1]![0] as () => void;
  await act(async () => {
    latest();
  });
}

describe('starter recipe offer — regressions found by review', () => {
  it('never flashes the offer for an established household with a cold mirror', async () => {
    // The reinstall case as it actually arrives: the local read returns
    // empty, the sync pulls the real library into SQLite, and the
    // *re-read* then returns it. The re-read is deliberately left
    // pending here — with instantly-resolving mocks React batches the
    // whole chain into one commit and the bug is invisible, which is
    // exactly how the first version of this test passed against the
    // broken code.
    const cold: LibraryRecipe[] = [];
    const real = [recipe({ id: 'r1', title: 'Chili' })];
    let resolveRefresh: (value: LibraryRecipe[]) => void = () => {};
    const pendingRefresh = new Promise<LibraryRecipe[]>((resolve) => {
      resolveRefresh = resolve;
    });

    let syncDone = false;
    mockedSyncHousehold.mockImplementation(() => {
      syncDone = true;
      return Promise.resolve(undefined);
    });
    mockedReadLocalLibraryRecipes.mockImplementation(() =>
      syncDone ? pendingRefresh : Promise.resolve(cold),
    );

    await render(<LibraryScreen />);
    // Sync has finished; the refreshed list has not landed yet. This is
    // the whole window — settling here means judging the offer against
    // the pre-sync empty array.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('library-starter-offer')).toBeNull();
    expect(mockedTrackEvent).not.toHaveBeenCalledWith('starter_recipes_offered');

    await act(async () => {
      resolveRefresh(real);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());
    expect(screen.queryByTestId('library-starter-offer')).toBeNull();
    expect(mockedTrackEvent).not.toHaveBeenCalledWith('starter_recipes_offered');
  });

  it('does not offer when the sync failed, however empty the mirror looks', async () => {
    // A cold mirror plus a failed sync is indistinguishable from an
    // empty household — which is how an established one gets offered
    // starters the server can only refuse. Costs nothing to exclude:
    // seeding needs the network anyway, so an offer shown offline could
    // never have succeeded.
    mockedReadLocalLibraryRecipes.mockResolvedValue([]);
    mockedSyncHousehold.mockRejectedValue(new Error('offline'));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('library-starter-offer')).toBeNull();
    expect(mockedTrackEvent).not.toHaveBeenCalledWith('starter_recipes_offered');
  });

  it('does not re-offer after seeding and then emptying the library in one session', async () => {
    // The household snapshot in context still carries the pre-seed
    // stamp, so without a local record this returns to a dead button.
    let hasSeeded = false;
    let emptied = false;
    const empty: LibraryRecipe[] = [];
    const seeded = [recipe({ id: 'r1', title: 'Weeknight Bolognese' })];
    mockedReadLocalLibraryRecipes.mockImplementation(() =>
      Promise.resolve(hasSeeded && !emptied ? seeded : empty),
    );
    mockedSeedStarterRecipes.mockImplementation(() => {
      hasSeeded = true;
      return Promise.resolve({ seeded: true, recipeCount: 10 });
    });
    // The provider refetch is what makes the stamp visible to every
    // reader, so the mock has to actually move it — a jest.fn() that
    // resolves would let a screen-local flag pass this test too.
    const household = { id: 'h1', starterRecipesSeededAt: null as string | null };
    mockedUseHousehold.mockReturnValue({
      household,
      refreshHousehold: jest.fn(() => {
        household.starterRecipesSeededAt = '2026-09-01T00:00:00.000Z';
        return Promise.resolve();
      }),
    });

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('library-starter-offer-action'));
    await waitFor(() => expect(screen.getByText('Weeknight Bolognese')).toBeTruthy());

    // The user archives or deletes all ten and comes back.
    emptied = true;
    await refireFocusEffect();

    await waitFor(() => expect(screen.getByTestId('library-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('library-starter-offer')).toBeNull();
  });

  it('reports a second impression when the offer returns', async () => {
    // Decline, add a recipe, delete it, come back — Library never
    // unmounts, so a guard keyed to the screen would swallow this while
    // starter_recipes_added could still fire.
    let populated = false;
    const empty: LibraryRecipe[] = [];
    const one = [recipe({ id: 'r1', title: 'Chili' })];
    mockedReadLocalLibraryRecipes.mockImplementation(() =>
      Promise.resolve(populated ? one : empty),
    );

    await render(<LibraryScreen />);
    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());

    populated = true;
    await refireFocusEffect();
    await waitFor(() => expect(screen.getByText('Chili')).toBeTruthy());

    populated = false;
    await refireFocusEffect();
    await waitFor(() => expect(screen.getByTestId('library-starter-offer')).toBeTruthy());

    expect(
      mockedTrackEvent.mock.calls.filter(([n]) => n === 'starter_recipes_offered'),
    ).toHaveLength(2);
  });
});
