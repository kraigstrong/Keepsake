import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { getCookingHistory } from './api';
import { CookingModeScreen } from './CookingModeScreen';
import { enqueueCookingEvent } from './outbox';
import { submitPendingCookingEvents } from './outboxEngine';
import { useCookingSession } from './useCookingSession';
import { ToastProvider } from '../components/Toast';
import { useConnectivity } from '../connectivity/ConnectivityProvider';
import { getDatabase } from '../db/database';
import { useHousehold } from '../household/HouseholdProvider';
import { logError } from '../observability';
import type { Recipe } from '../recipes/api';
import { fetchCurrentWeeklyPlan, removeConfirmedEntryFromThisWeek } from '../thisWeek/api';

jest.mock('./useCookingSession', () => ({ useCookingSession: jest.fn() }));
// formatCookedAt stays real (jest.requireActual), same reasoning as
// RecipeDetailScreen.test.tsx — this suite asserts on its actual
// formatted output, only getCookingHistory itself needs mocking.
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getCookingHistory: jest.fn(),
}));
jest.mock('./outbox', () => ({ enqueueCookingEvent: jest.fn() }));
jest.mock('./outboxEngine', () => ({ submitPendingCookingEvents: jest.fn() }));
jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('../connectivity/ConnectivityProvider', () => ({ useConnectivity: jest.fn() }));
jest.mock('../keepAwake/useCookingModeAwake', () => ({ useCookingModeAwake: jest.fn() }));
jest.mock('../observability', () => ({ logError: jest.fn() }));
jest.mock('../thisWeek/api', () => ({
  fetchCurrentWeeklyPlan: jest.fn(),
  removeConfirmedEntryFromThisWeek: jest.fn(),
}));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
// ./useCookingSession is auto-mocked above, but Jest still loads the real
// module once to derive its shape, which pulls in recipes/api.ts and
// trips supabase/instance.ts's missing-env-var throw — same pattern as
// RecipeDetailScreen.test.tsx.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedUseCookingSession = useCookingSession as jest.Mock;
const mockedEnqueueCookingEvent = enqueueCookingEvent as jest.Mock;
const mockedSubmitPendingCookingEvents = submitPendingCookingEvents as jest.Mock;
const mockedGetDatabase = getDatabase as jest.Mock;
const mockedUseHousehold = useHousehold as jest.Mock;
const mockedUseConnectivity = useConnectivity as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;
const mockedGetCookingHistory = getCookingHistory as jest.Mock;
const mockedFetchCurrentWeeklyPlan = fetchCurrentWeeklyPlan as jest.Mock;
const mockedRemoveConfirmedEntry = removeConfirmedEntryFromThisWeek as jest.Mock;
const mockedLogError = logError as jest.Mock;

const back = jest.fn();
const fakeDb = { fake: 'db' };

const recipe: Recipe = {
  id: 'recipe-1',
  version: 1,
  title: 'Herb Roast Chicken',
  heroImagePath: null,
  originalPhotoPath: null,
  activeTimeMinutes: 20,
  totalTimeMinutes: 70,
  yieldText: 'Serves 4',
  servingsCount: 4,
  permanentNotes: null,
  sourceUrl: null,
  sourceAttribution: null,
  tags: [],
  categoryIds: [],
  ingredientSections: [
    {
      title: null,
      lines: [
        {
          lineText: '1 whole chicken',
          quantityMin: 1,
          quantityMax: 1,
          unit: null,
          ingredientText: 'whole chicken',
        },
      ],
    },
  ],
  instructionSections: [{ title: null, lines: ['Preheat the oven.', 'Roast it.'] }],
  archivedAt: null,
  deletedAt: null,
};

async function renderCookingModeScreen() {
  const result = await render(
    <ToastProvider>
      <CookingModeScreen recipeId="recipe-1" />
    </ToastProvider>,
  );
  // Every test starts from the plan-lookup effect having settled, same
  // as useCookingSession's own load — avoids "not wrapped in act"
  // noise from that effect resolving mid-assertion.
  await waitFor(() => expect(mockedFetchCurrentWeeklyPlan).toHaveBeenCalled());
  return result;
}

// Opening the sheet flips Modal's `visible` via a state update rather
// than an initial prop (unlike Sheet.test.tsx's own tests, which start
// already visible) — React 19's test renderer needs an explicit flush
// before the sheet's children are queryable, same "act must be awaited"
// class of issue as elsewhere in this session's tests.
async function openDoneCookingSheet() {
  fireEvent.press(screen.getByTestId('cooking-mode-done-button'));
  await waitFor(() => expect(screen.getByTestId('done-cooking-sheet')).toBeTruthy());
}

let toggleIngredient: jest.Mock;
let toggleInstruction: jest.Mock;
let resetChecklist: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  toggleIngredient = jest.fn();
  toggleInstruction = jest.fn();
  resetChecklist = jest.fn();
  mockedUseRouter.mockReturnValue({ back });
  mockedUseHousehold.mockReturnValue({
    household: { id: 'h1' },
    profile: { id: 'user-1', displayName: 'Alice', preferredUnitSystem: 'us_customary' },
  });
  mockedUseConnectivity.mockReturnValue({ isOnline: true });
  mockedGetDatabase.mockResolvedValue(fakeDb);
  mockedSubmitPendingCookingEvents.mockResolvedValue(undefined);
  mockedGetCookingHistory.mockResolvedValue([]);
  // No confirmed plan by default — most tests don't care about the
  // removal toggle; the tests that do override this explicitly.
  mockedFetchCurrentWeeklyPlan.mockRejectedValue(new Error('no current plan'));
  mockedUseCookingSession.mockReturnValue({
    recipe,
    isLoading: false,
    loadError: false,
    checkedIngredientKeys: new Set<string>(),
    checkedInstructionKeys: new Set<string>(),
    toggleIngredient,
    toggleInstruction,
    resetChecklist,
  });
});

describe('CookingModeScreen', () => {
  it('shows a loading state while the recipe loads', async () => {
    mockedUseCookingSession.mockReturnValue({
      recipe: null,
      isLoading: true,
      loadError: false,
      checkedIngredientKeys: new Set(),
      checkedInstructionKeys: new Set(),
      toggleIngredient,
      toggleInstruction,
      resetChecklist,
    });
    await render(
      <ToastProvider>
        <CookingModeScreen recipeId="recipe-1" />
      </ToastProvider>,
    );
    expect(screen.getByTestId('cooking-mode-loading')).toBeTruthy();
  });

  it('shows an error state when the recipe fails to load', async () => {
    mockedUseCookingSession.mockReturnValue({
      recipe: null,
      isLoading: false,
      loadError: true,
      checkedIngredientKeys: new Set(),
      checkedInstructionKeys: new Set(),
      toggleIngredient,
      toggleInstruction,
      resetChecklist,
    });
    await render(
      <ToastProvider>
        <CookingModeScreen recipeId="recipe-1" />
      </ToastProvider>,
    );
    expect(screen.getByTestId('cooking-mode-load-error')).toBeTruthy();
  });

  it('renders the recipe title, ingredients, and instructions', async () => {
    await renderCookingModeScreen();
    expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();
    expect(screen.getByTestId('cooking-mode-ingredient-0-0')).toBeTruthy();
    expect(screen.getByTestId('cooking-mode-instruction-0-0')).toBeTruthy();
    expect(screen.getByTestId('cooking-mode-instruction-0-1')).toBeTruthy();
  });

  it('tapping an ingredient row calls toggleIngredient with its positional key', async () => {
    await renderCookingModeScreen();
    fireEvent.press(screen.getByTestId('cooking-mode-ingredient-0-0'));
    expect(toggleIngredient).toHaveBeenCalledWith('0-0');
  });

  it('tapping an instruction row calls toggleInstruction with its positional key', async () => {
    await renderCookingModeScreen();
    fireEvent.press(screen.getByTestId('cooking-mode-instruction-0-1'));
    expect(toggleInstruction).toHaveBeenCalledWith('0-1');
  });

  it('reflects checked state via accessibilityState', async () => {
    mockedUseCookingSession.mockReturnValue({
      recipe,
      isLoading: false,
      loadError: false,
      checkedIngredientKeys: new Set(['0-0']),
      checkedInstructionKeys: new Set(),
      toggleIngredient,
      toggleInstruction,
      resetChecklist,
    });
    await renderCookingModeScreen();
    expect(screen.getByTestId('cooking-mode-ingredient-0-0').props.accessibilityState).toEqual({
      checked: true,
    });
  });

  it('the reset button calls resetChecklist', async () => {
    await renderCookingModeScreen();
    fireEvent.press(screen.getByTestId('cooking-mode-reset-button'));
    expect(resetChecklist).toHaveBeenCalled();
  });

  it('scaling preset chips rescale ingredient quantities', async () => {
    await renderCookingModeScreen();
    fireEvent.press(screen.getByTestId('cooking-mode-scale-preset-2'));
    await waitFor(() => expect(screen.getByText(/2 whole chicken/)).toBeTruthy());
  });

  describe('defaulting the scale to the This-Week plan (developer feedback: first walkthrough)', () => {
    it('defaults to the planned servings when this recipe is on the confirmed plan at a different count', async () => {
      mockedFetchCurrentWeeklyPlan.mockResolvedValue({
        id: 'plan-1',
        status: 'confirmed',
        entries: [
          {
            id: 'entry-1',
            recipeId: 'recipe-1',
            title: '',
            heroImagePath: null,
            multiplier: 2,
            position: 0,
          },
        ],
      });

      await renderCookingModeScreen();

      await waitFor(() => expect(screen.getByText(/2 whole chicken/)).toBeTruthy());
      expect(screen.getByTestId('cooking-mode-scale-preset-2').props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      );
    });

    it('a manual scale-chip tap is never overwritten once the plan lookup resolves late', async () => {
      let resolvePlan: (plan: unknown) => void;
      mockedFetchCurrentWeeklyPlan.mockReturnValue(
        new Promise((resolve) => {
          resolvePlan = resolve;
        }),
      );

      await render(
        <ToastProvider>
          <CookingModeScreen recipeId="recipe-1" />
        </ToastProvider>,
      );
      fireEvent.press(screen.getByTestId('cooking-mode-scale-preset-2'));
      await waitFor(() => expect(screen.getByText(/2 whole chicken/)).toBeTruthy());

      // Codex review, PR #50: waiting on the mock having been *called*
      // proves nothing — that happened synchronously on mount, before
      // the promise below even resolves. Wrapping the resolve in `act`
      // and then asserting on something that only appears once the
      // resolved plan's state has actually committed (the remove-toggle,
      // gated on planEntryId) is what actually exercises the race.
      await act(async () => {
        resolvePlan!({
          id: 'plan-1',
          status: 'confirmed',
          entries: [
            {
              id: 'entry-1',
              recipeId: 'recipe-1',
              title: '',
              heroImagePath: null,
              multiplier: 1,
              position: 0,
            },
          ],
        });
      });
      fireEvent.press(screen.getByTestId('cooking-mode-done-button'));
      await waitFor(() =>
        expect(screen.getByTestId('done-cooking-remove-from-plan-toggle')).toBeTruthy(),
      );

      // Plan says 1x (4/4), but the user already chose 2x before it
      // resolved — stays 2x.
      expect(screen.getByText(/2 whole chicken/)).toBeTruthy();
    });

    it('does not touch the scale when there is no matching confirmed plan entry', async () => {
      await renderCookingModeScreen();
      expect(screen.getByText(/1 whole chicken/)).toBeTruthy();
    });

    // ADR-0026: the plan entry's multiplier is read directly, with no
    // dependency on recipe.servingsCount at all — a null servings count
    // (this used to skip defaulting the scale entirely, Codex review,
    // PR #50) no longer matters here one way or the other.
    it('defaults the scale from the plan entry even when the recipe has no parsed servings count', async () => {
      mockedUseCookingSession.mockReturnValue({
        recipe: { ...recipe, servingsCount: null },
        isLoading: false,
        loadError: false,
        checkedIngredientKeys: new Set<string>(),
        checkedInstructionKeys: new Set<string>(),
        toggleIngredient,
        toggleInstruction,
        resetChecklist,
      });
      mockedFetchCurrentWeeklyPlan.mockResolvedValue({
        id: 'plan-1',
        status: 'confirmed',
        entries: [
          {
            id: 'entry-1',
            recipeId: 'recipe-1',
            title: '',
            heroImagePath: null,
            multiplier: 2,
            position: 0,
          },
        ],
      });

      await renderCookingModeScreen();
      expect(screen.getByText(/2 whole chicken/)).toBeTruthy();
    });
  });

  describe('Done Cooking', () => {
    it('tapping Done Cooking opens the confirmation sheet rather than completing immediately', async () => {
      await renderCookingModeScreen();
      await openDoneCookingSheet();
      expect(screen.getByTestId('done-cooking-sheet')).toBeTruthy();
      expect(mockedEnqueueCookingEvent).not.toHaveBeenCalled();
    });

    it('confirming with no note enqueues a cooking event with a null note, clears the checklist, and navigates back', async () => {
      mockedEnqueueCookingEvent.mockResolvedValue(undefined);
      await renderCookingModeScreen();
      await openDoneCookingSheet();

      fireEvent.press(screen.getByTestId('done-cooking-confirm-button'));

      await waitFor(() =>
        expect(mockedEnqueueCookingEvent).toHaveBeenCalledWith(
          fakeDb,
          'recipe-1',
          'h1',
          expect.any(String),
          null,
        ),
      );
      expect(resetChecklist).toHaveBeenCalled();
      expect(back).toHaveBeenCalled();
      expect(mockedSubmitPendingCookingEvents).toHaveBeenCalledWith('h1');
    });

    it('confirming via onTouchStart alone still completes — the touch-lost-gesture workaround', async () => {
      mockedEnqueueCookingEvent.mockResolvedValue(undefined);
      await renderCookingModeScreen();
      await openDoneCookingSheet();

      await fireEvent(screen.getByTestId('done-cooking-confirm-button'), 'touchStart');

      await waitFor(() => expect(mockedEnqueueCookingEvent).toHaveBeenCalledTimes(1));
    });

    it('does not double-enqueue when both onTouchStart and onPress fire for one activation', async () => {
      mockedEnqueueCookingEvent.mockResolvedValue(undefined);
      await renderCookingModeScreen();
      await openDoneCookingSheet();

      const confirmButton = screen.getByTestId('done-cooking-confirm-button');
      await fireEvent(confirmButton, 'touchStart');
      await fireEvent.press(confirmButton);

      await waitFor(() => expect(mockedEnqueueCookingEvent).toHaveBeenCalledTimes(1));
    });

    it('confirming with a note trims it and passes it through', async () => {
      mockedEnqueueCookingEvent.mockResolvedValue(undefined);
      await renderCookingModeScreen();
      await openDoneCookingSheet();

      fireEvent.changeText(screen.getByTestId('done-cooking-note-input'), '  Needed more salt.  ');
      await waitFor(() =>
        expect(screen.getByTestId('done-cooking-note-input').props.value).toBe(
          '  Needed more salt.  ',
        ),
      );
      fireEvent.press(screen.getByTestId('done-cooking-confirm-button'));

      await waitFor(() =>
        expect(mockedEnqueueCookingEvent).toHaveBeenCalledWith(
          fakeDb,
          'recipe-1',
          'h1',
          expect.any(String),
          'Needed more salt.',
        ),
      );
    });

    it('does nothing when Done Cooking is tapped without a household', async () => {
      mockedUseHousehold.mockReturnValue({ household: null });
      await renderCookingModeScreen();
      await openDoneCookingSheet();

      fireEvent.press(screen.getByTestId('done-cooking-confirm-button'));

      await Promise.resolve();
      expect(mockedEnqueueCookingEvent).not.toHaveBeenCalled();
    });

    it('does not show the remove-from-plan toggle when this recipe is not on a confirmed plan', async () => {
      await renderCookingModeScreen();
      await openDoneCookingSheet();
      expect(screen.queryByTestId('done-cooking-remove-from-plan-toggle')).toBeNull();
    });

    it('does not show the remove-from-plan toggle while offline, even with a matching confirmed entry', async () => {
      mockedUseConnectivity.mockReturnValue({ isOnline: false });
      mockedFetchCurrentWeeklyPlan.mockResolvedValue({
        id: 'plan-1',
        status: 'confirmed',
        entries: [
          {
            id: 'entry-1',
            recipeId: 'recipe-1',
            title: '',
            heroImagePath: null,
            multiplier: 1,
            position: 0,
          },
        ],
      });
      await renderCookingModeScreen();
      await openDoneCookingSheet();
      expect(screen.queryByTestId('done-cooking-remove-from-plan-toggle')).toBeNull();
    });

    it('defaults the toggle to checked and removes the plan entry on confirm, untouched', async () => {
      mockedFetchCurrentWeeklyPlan.mockResolvedValue({
        id: 'plan-1',
        status: 'confirmed',
        entries: [
          {
            id: 'entry-1',
            recipeId: 'recipe-1',
            title: '',
            heroImagePath: null,
            multiplier: 1,
            position: 0,
          },
        ],
      });
      mockedEnqueueCookingEvent.mockResolvedValue(undefined);
      mockedRemoveConfirmedEntry.mockResolvedValue(undefined);
      await renderCookingModeScreen();
      await openDoneCookingSheet();
      await waitFor(() =>
        expect(
          screen.getByTestId('done-cooking-remove-from-plan-toggle').props.accessibilityState,
        ).toEqual({ checked: true }),
      );

      fireEvent.press(screen.getByTestId('done-cooking-confirm-button'));

      await waitFor(() => expect(mockedRemoveConfirmedEntry).toHaveBeenCalledWith('entry-1'));
    });

    // Codex review, PR #50: the toggle's default was only ever applied
    // on the sheet's own visible false->true transition. Opening the
    // sheet while the plan lookup is still pending, then letting it
    // resolve *while the sheet stays open*, flips canRemoveFromPlan
    // false->true with visible unchanged — the toggle appeared and
    // stayed unchecked instead of defaulting to checked.
    it('defaults the toggle to checked once plan eligibility resolves while the sheet is already open', async () => {
      let resolvePlan: (plan: unknown) => void;
      mockedFetchCurrentWeeklyPlan.mockReturnValue(
        new Promise((resolve) => {
          resolvePlan = resolve;
        }),
      );

      await renderCookingModeScreen();
      await openDoneCookingSheet();
      expect(screen.queryByTestId('done-cooking-remove-from-plan-toggle')).toBeNull();

      await act(async () => {
        resolvePlan!({
          id: 'plan-1',
          status: 'confirmed',
          entries: [
            {
              id: 'entry-1',
              recipeId: 'recipe-1',
              title: '',
              heroImagePath: null,
              multiplier: 1,
              position: 0,
            },
          ],
        });
      });

      expect(
        screen.getByTestId('done-cooking-remove-from-plan-toggle').props.accessibilityState,
      ).toEqual({ checked: true });
    });

    it('a manual uncheck before plan eligibility resolves is not overwritten once it does', async () => {
      let resolvePlan: (plan: unknown) => void;
      mockedFetchCurrentWeeklyPlan.mockReturnValue(
        new Promise((resolve) => {
          resolvePlan = resolve;
        }),
      );

      await renderCookingModeScreen();
      await openDoneCookingSheet();
      expect(screen.queryByTestId('done-cooking-remove-from-plan-toggle')).toBeNull();

      await act(async () => {
        resolvePlan!({
          id: 'plan-1',
          status: 'confirmed',
          entries: [
            {
              id: 'entry-1',
              recipeId: 'recipe-1',
              title: '',
              heroImagePath: null,
              multiplier: 1,
              position: 0,
            },
          ],
        });
      });
      fireEvent.press(screen.getByTestId('done-cooking-remove-from-plan-toggle'));
      await waitFor(() =>
        expect(
          screen.getByTestId('done-cooking-remove-from-plan-toggle').props.accessibilityState,
        ).toEqual({ checked: false }),
      );

      fireEvent.press(screen.getByTestId('done-cooking-confirm-button'));

      await waitFor(() => expect(mockedEnqueueCookingEvent).toHaveBeenCalled());
      expect(mockedRemoveConfirmedEntry).not.toHaveBeenCalled();
    });

    it('leaves the plan entry alone when the default-checked toggle is unchecked before confirming', async () => {
      mockedFetchCurrentWeeklyPlan.mockResolvedValue({
        id: 'plan-1',
        status: 'confirmed',
        entries: [
          {
            id: 'entry-1',
            recipeId: 'recipe-1',
            title: '',
            heroImagePath: null,
            multiplier: 1,
            position: 0,
          },
        ],
      });
      mockedEnqueueCookingEvent.mockResolvedValue(undefined);
      await renderCookingModeScreen();
      await openDoneCookingSheet();
      await waitFor(() =>
        expect(screen.getByTestId('done-cooking-remove-from-plan-toggle')).toBeTruthy(),
      );

      fireEvent.press(screen.getByTestId('done-cooking-remove-from-plan-toggle'));
      await waitFor(() =>
        expect(
          screen.getByTestId('done-cooking-remove-from-plan-toggle').props.accessibilityState,
        ).toEqual({ checked: false }),
      );
      fireEvent.press(screen.getByTestId('done-cooking-confirm-button'));

      await waitFor(() => expect(mockedEnqueueCookingEvent).toHaveBeenCalled());
      expect(mockedRemoveConfirmedEntry).not.toHaveBeenCalled();
    });

    it('a failed removal is logged and toasted, but does not undo the already-recorded completion', async () => {
      mockedFetchCurrentWeeklyPlan.mockResolvedValue({
        id: 'plan-1',
        status: 'confirmed',
        entries: [
          {
            id: 'entry-1',
            recipeId: 'recipe-1',
            title: '',
            heroImagePath: null,
            multiplier: 1,
            position: 0,
          },
        ],
      });
      mockedEnqueueCookingEvent.mockResolvedValue(undefined);
      mockedRemoveConfirmedEntry.mockRejectedValue(new Error('network error'));
      await renderCookingModeScreen();
      await openDoneCookingSheet();
      await waitFor(() =>
        expect(
          screen.getByTestId('done-cooking-remove-from-plan-toggle').props.accessibilityState,
        ).toEqual({ checked: true }),
      );

      fireEvent.press(screen.getByTestId('done-cooking-confirm-button'));

      await waitFor(() => expect(mockedLogError).toHaveBeenCalled());
      expect(mockedEnqueueCookingEvent).toHaveBeenCalled();
      expect(back).toHaveBeenCalled();
    });
  });

  // Found via live testing, 2026-08-14: Cooking Mode always showed a
  // recipe's original units verbatim, so a recipe whose source mixed
  // systems per-ingredient displayed that same mix scaled up — visibly
  // inconsistent even though each line was individually correct.
  describe('preferred unit system', () => {
    it("converts a metric ingredient to the household's preferred unit system", async () => {
      mockedUseCookingSession.mockReturnValue({
        recipe: {
          ...recipe,
          ingredientSections: [
            {
              title: null,
              lines: [
                {
                  lineText: '500 g flour',
                  quantityMin: 500,
                  quantityMax: 500,
                  unit: 'g',
                  ingredientText: 'flour',
                },
              ],
            },
          ],
        },
        isLoading: false,
        loadError: false,
        checkedIngredientKeys: new Set<string>(),
        checkedInstructionKeys: new Set<string>(),
        toggleIngredient,
        toggleInstruction,
        resetChecklist,
      });

      await renderCookingModeScreen();

      await waitFor(() => expect(screen.getByText('~1 lb flour')).toBeTruthy());
      expect(screen.queryByText('500 g flour')).toBeNull();
    });

    it("shows the original unit when the household's profile isn't loaded yet", async () => {
      mockedUseHousehold.mockReturnValue({ household: { id: 'h1' }, profile: null });
      mockedUseCookingSession.mockReturnValue({
        recipe: {
          ...recipe,
          ingredientSections: [
            {
              title: null,
              lines: [
                {
                  lineText: '500 g flour',
                  quantityMin: 500,
                  quantityMax: 500,
                  unit: 'g',
                  ingredientText: 'flour',
                },
              ],
            },
          ],
        },
        isLoading: false,
        loadError: false,
        checkedIngredientKeys: new Set<string>(),
        checkedInstructionKeys: new Set<string>(),
        toggleIngredient,
        toggleInstruction,
        resetChecklist,
      });

      await renderCookingModeScreen();

      expect(screen.getByText('500 g flour')).toBeTruthy();
    });
  });

  // Found via live testing, 2026-08-14: neither the recipe's own
  // permanent notes nor its past cooking history showed anywhere in
  // Cooking Mode.
  describe('notes and cooking history', () => {
    it("shows the recipe's permanent notes when present", async () => {
      mockedUseCookingSession.mockReturnValue({
        recipe: { ...recipe, permanentNotes: "Don't overmix the batter." },
        isLoading: false,
        loadError: false,
        checkedIngredientKeys: new Set<string>(),
        checkedInstructionKeys: new Set<string>(),
        toggleIngredient,
        toggleInstruction,
        resetChecklist,
      });

      await renderCookingModeScreen();

      expect(screen.getByTestId('cooking-mode-notes')).toBeTruthy();
      expect(screen.getByText("Don't overmix the batter.")).toBeTruthy();
    });

    it('shows no notes section when the recipe has none', async () => {
      await renderCookingModeScreen();

      expect(screen.queryByTestId('cooking-mode-notes')).toBeNull();
    });

    it('shows cooking history newest-first, with notes, once loaded', async () => {
      mockedGetCookingHistory.mockResolvedValue([
        {
          id: 'event-2',
          recipeId: 'recipe-1',
          cookedAt: '2026-08-10T18:00:00.000Z',
          note: 'Needed another 5 minutes.',
        },
        { id: 'event-1', recipeId: 'recipe-1', cookedAt: '2026-08-01T18:00:00.000Z', note: null },
      ]);

      await renderCookingModeScreen();

      await waitFor(() => expect(screen.getByTestId('cooking-mode-cooking-history')).toBeTruthy());
      expect(screen.getByText('Needed another 5 minutes.')).toBeTruthy();
      expect(screen.getByText('Aug 10, 2026')).toBeTruthy();
      expect(screen.getByText('Aug 1, 2026')).toBeTruthy();
    });

    it('shows no cooking history section when there is none yet', async () => {
      await renderCookingModeScreen();

      await waitFor(() => expect(mockedGetCookingHistory).toHaveBeenCalledWith('recipe-1'));
      expect(screen.queryByTestId('cooking-mode-cooking-history')).toBeNull();
    });
  });
});
