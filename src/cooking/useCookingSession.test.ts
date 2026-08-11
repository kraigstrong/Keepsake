import { act, renderHook, waitFor } from '@testing-library/react-native';

import { clearCookingSession, getCookingSession, saveCookingSession } from './checklistState';
import { useCookingSession } from './useCookingSession';
import { getDatabase } from '../db/database';
import { useHousehold } from '../household/HouseholdProvider';
import { fetchRecipe, type Recipe } from '../recipes/api';
import { readLocalRecipe } from '../sync/offlineRecipes';

// act() must be awaited even for a synchronous callback — React 19's test
// renderer treats act() as always-async internally, and an un-awaited
// call leaves a dangling flush that bleeds into (and corrupts) whichever
// test runs next (see ConnectivityProvider.test.tsx's own note).

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('../recipes/api', () => ({ fetchRecipe: jest.fn() }));
jest.mock('../sync/offlineRecipes', () => ({ readLocalRecipe: jest.fn() }));
jest.mock('./checklistState', () => ({
  getCookingSession: jest.fn(),
  saveCookingSession: jest.fn(),
  clearCookingSession: jest.fn(),
}));
// ../recipes/api is auto-mocked above, but Jest still loads the real
// module once to derive its shape, tripping supabase/instance.ts's
// missing-env-var throw — same pattern as HouseholdProvider.test.tsx.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedGetDatabase = getDatabase as jest.Mock;
const mockedUseHousehold = useHousehold as jest.Mock;
const mockedFetchRecipe = fetchRecipe as jest.Mock;
const mockedReadLocalRecipe = readLocalRecipe as jest.Mock;
const mockedGetCookingSession = getCookingSession as jest.Mock;
const mockedSaveCookingSession = saveCookingSession as jest.Mock;
const mockedClearCookingSession = clearCookingSession as jest.Mock;

const fakeDb = { fake: 'db' };
const RECIPE_ID = 'recipe-1';
const HOUSEHOLD_ID = 'hh1';

const recipe: Recipe = {
  id: RECIPE_ID,
  version: 1,
  title: 'Herb Roast Chicken',
  heroImagePath: null,
  originalPhotoPath: null,
  activeTimeMinutes: 20,
  totalTimeMinutes: 60,
  yieldText: 'Serves 4',
  servingsCount: 4,
  permanentNotes: null,
  sourceUrl: null,
  sourceAttribution: null,
  tags: [],
  categoryIds: [],
  ingredientSections: [{ title: null, lines: [] }],
  instructionSections: [{ title: null, lines: ['Preheat oven.'] }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDatabase.mockResolvedValue(fakeDb);
  mockedUseHousehold.mockReturnValue({ household: { id: HOUSEHOLD_ID } });
  mockedReadLocalRecipe.mockResolvedValue(null);
  mockedFetchRecipe.mockResolvedValue(recipe);
  mockedGetCookingSession.mockResolvedValue(null);
});

describe('useCookingSession', () => {
  it('loads the recipe and an empty checklist when no session exists yet', async () => {
    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.recipe).toEqual(recipe);
    expect(result.current.checkedIngredientKeys).toEqual(new Set());
    expect(result.current.checkedInstructionKeys).toEqual(new Set());
    expect(result.current.loadError).toBe(false);
  });

  it('resumes a previously-saved checklist', async () => {
    mockedGetCookingSession.mockResolvedValue({
      recipeId: RECIPE_ID,
      checkedIngredientKeys: ['0-0'],
      checkedInstructionKeys: [],
      updatedAt: '2026-08-10T18:00:00.000Z',
    });

    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));

    await waitFor(() => expect(result.current.checkedIngredientKeys).toEqual(new Set(['0-0'])));
  });

  it('toggling an ingredient updates state and persists it', async () => {
    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.toggleIngredient('0-0');
    });

    await waitFor(() => expect(result.current.checkedIngredientKeys).toEqual(new Set(['0-0'])));
    await waitFor(() =>
      expect(mockedSaveCookingSession).toHaveBeenCalledWith(fakeDb, RECIPE_ID, ['0-0'], []),
    );
  });

  it('toggling the same key again unchecks it', async () => {
    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.toggleIngredient('0-0');
    });
    await waitFor(() => expect(result.current.checkedIngredientKeys).toEqual(new Set(['0-0'])));
    await act(async () => {
      result.current.toggleIngredient('0-0');
    });

    await waitFor(() => expect(result.current.checkedIngredientKeys).toEqual(new Set()));
  });

  it('does not persist a session on initial load (only real toggles after)', async () => {
    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockedSaveCookingSession).not.toHaveBeenCalled();
  });

  it('resetChecklist clears both key sets and deletes the local row', async () => {
    mockedGetCookingSession.mockResolvedValue({
      recipeId: RECIPE_ID,
      checkedIngredientKeys: ['0-0'],
      checkedInstructionKeys: ['0-0'],
      updatedAt: '2026-08-10T18:00:00.000Z',
    });
    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));
    await waitFor(() => expect(result.current.checkedIngredientKeys.size).toBe(1));

    await act(async () => {
      result.current.resetChecklist();
    });

    expect(result.current.checkedIngredientKeys).toEqual(new Set());
    expect(result.current.checkedInstructionKeys).toEqual(new Set());
    await waitFor(() => expect(mockedClearCookingSession).toHaveBeenCalledWith(fakeDb, RECIPE_ID));
  });

  it('falls back to the live fetch result when there is no local cache', async () => {
    mockedUseHousehold.mockReturnValue({ household: null });

    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));

    await waitFor(() => expect(result.current.recipe).toEqual(recipe));
    expect(mockedReadLocalRecipe).not.toHaveBeenCalled();
  });

  it('surfaces a load error only when neither the local nor live read has data', async () => {
    mockedUseHousehold.mockReturnValue({ household: null });
    mockedFetchRecipe.mockRejectedValue(new Error('offline'));

    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));

    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.recipe).toBeNull();
  });

  it('still loads the saved checklist when offline with a local recipe cache hit (regression: an early return used to skip it)', async () => {
    mockedReadLocalRecipe.mockResolvedValue(recipe);
    mockedFetchRecipe.mockRejectedValue(new Error('offline'));
    mockedGetCookingSession.mockResolvedValue({
      recipeId: RECIPE_ID,
      checkedIngredientKeys: ['0-0'],
      checkedInstructionKeys: [],
      updatedAt: '2026-08-10T18:00:00.000Z',
    });

    const { result } = await renderHook(() => useCookingSession(RECIPE_ID));

    await waitFor(() => expect(result.current.recipe).toEqual(recipe));
    expect(result.current.loadError).toBe(false);
    await waitFor(() => expect(result.current.checkedIngredientKeys).toEqual(new Set(['0-0'])));
  });
});
