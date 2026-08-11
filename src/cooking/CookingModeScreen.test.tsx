import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { CookingModeScreen } from './CookingModeScreen';
import { enqueueCookingEvent } from './outbox';
import { submitPendingCookingEvents } from './outboxEngine';
import { useCookingSession } from './useCookingSession';
import { ToastProvider } from '../components/Toast';
import { getDatabase } from '../db/database';
import { useHousehold } from '../household/HouseholdProvider';
import type { Recipe } from '../recipes/api';

jest.mock('./useCookingSession', () => ({ useCookingSession: jest.fn() }));
jest.mock('./outbox', () => ({ enqueueCookingEvent: jest.fn() }));
jest.mock('./outboxEngine', () => ({ submitPendingCookingEvents: jest.fn() }));
jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('../keepAwake/useCookingModeAwake', () => ({ useCookingModeAwake: jest.fn() }));
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
const mockedUseRouter = useRouter as jest.Mock;

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
};

async function renderCookingModeScreen() {
  return await render(
    <ToastProvider>
      <CookingModeScreen recipeId="recipe-1" />
    </ToastProvider>,
  );
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
  mockedUseHousehold.mockReturnValue({ household: { id: 'h1' } });
  mockedGetDatabase.mockResolvedValue(fakeDb);
  mockedSubmitPendingCookingEvents.mockResolvedValue(undefined);
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
    await renderCookingModeScreen();
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
    await renderCookingModeScreen();
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

  it('Done Cooking enqueues a cooking event, clears the checklist, and navigates back', async () => {
    mockedEnqueueCookingEvent.mockResolvedValue(undefined);
    await renderCookingModeScreen();

    fireEvent.press(screen.getByTestId('cooking-mode-done-button'));

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

  it('does nothing when Done Cooking is tapped without a household', async () => {
    mockedUseHousehold.mockReturnValue({ household: null });
    await renderCookingModeScreen();

    fireEvent.press(screen.getByTestId('cooking-mode-done-button'));

    await Promise.resolve();
    expect(mockedEnqueueCookingEvent).not.toHaveBeenCalled();
  });

  it('scaling preset chips rescale ingredient quantities', async () => {
    await renderCookingModeScreen();
    fireEvent.press(screen.getByTestId('cooking-mode-scale-preset-2'));
    await waitFor(() => expect(screen.getByText(/2 whole chicken/)).toBeTruthy());
  });
});
