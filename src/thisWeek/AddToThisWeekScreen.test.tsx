import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { AddToThisWeekScreen } from './AddToThisWeekScreen';
import * as thisWeekApi from './api';
import * as recipesApi from '../recipes/api';
import { ToastProvider } from '../components/Toast';

jest.mock('./api');
jest.mock('../recipes/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));
// This screen reads useSafeAreaInsets directly (headerShown: false, no
// native header to reserve Dynamic-Island/notch space — see
// AddToThisWeekScreen.tsx), so it needs the library's own test double
// rather than the real native-backed provider.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

function renderScreen() {
  return render(
    <ToastProvider>
      <AddToThisWeekScreen planId="plan-1" />
    </ToastProvider>,
  );
}

const mockedThisWeekApi = thisWeekApi as jest.Mocked<typeof thisWeekApi>;
const mockedRecipesApi = recipesApi as jest.Mocked<typeof recipesApi>;
const mockedUseRouter = useRouter as jest.Mock;

const back = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ back });
  mockedRecipesApi.fetchRecipes.mockResolvedValue([
    { id: 'r1', title: 'Herb Roast Chicken', servingsCount: null },
    { id: 'r2', title: 'Tacos', servingsCount: null },
  ]);
  mockedThisWeekApi.addRecipesToThisWeek.mockResolvedValue(undefined);
});

it('shows an error state when recipes fail to load', async () => {
  mockedRecipesApi.fetchRecipes.mockRejectedValue(new Error('boom'));

  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('add-to-this-week-load-error')).toBeTruthy());
});

it('filters the list by search text', async () => {
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('add-to-this-week-search'), 'taco');

  expect(screen.queryByText('Herb Roast Chicken')).toBeNull();
  expect(screen.getByText('Tacos')).toBeTruthy();
});

it('disables Next until at least one recipe is selected, then advances to the servings step', async () => {
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.getByTestId('add-to-this-week-next').props.accessibilityState.disabled).toBe(true);

  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  expect(screen.getByTestId('add-to-this-week-next').props.accessibilityState.disabled).toBe(false);

  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));

  expect(screen.getByText('Choose Servings')).toBeTruthy();
  expect(screen.getByTestId('add-to-this-week-servings-r1')).toBeTruthy();
  expect(screen.queryByTestId('add-to-this-week-servings-r2')).toBeNull();
});

// ADR-0026 amendment (developer decision, 2026-08-14): every recipe
// gets the same scale-multiplier chips here regardless of
// servingsCount — a servings-based stepper existed for the known-count
// case (decision 3) but didn't fit compactly next to a long title and
// read as inconsistent across a mixed selection. servingsCount is
// still shown on Recipe Detail; it no longer picks the control type
// on this screen.
it('shows preset chips for every recipe, regardless of parsed servings count', async () => {
  mockedRecipesApi.fetchRecipes.mockResolvedValue([
    { id: 'r1', title: 'Nacho Cheese Sauce', servingsCount: 6 },
    { id: 'r2', title: 'Tacos', servingsCount: null },
  ]);

  await renderScreen();

  await waitFor(() => expect(screen.getByText('Nacho Cheese Sauce')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));

  expect(screen.getByTestId('add-to-this-week-scale-preset-r1-1').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: true }),
  );

  await fireEvent.press(screen.getByTestId('add-to-this-week-scale-preset-r1-2'));

  expect(screen.getByTestId('add-to-this-week-scale-preset-r1-2').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: true }),
  );
  expect(screen.getByTestId('add-to-this-week-scale-preset-r1-1').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: false }),
  );
});

it('going back from the servings step preserves the selection', async () => {
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-back'));

  expect(screen.getByText('Add Recipes')).toBeTruthy();
  expect(screen.getByTestId('add-to-this-week-recipe-r1').props.accessibilityState.checked).toBe(
    true,
  );
});

it('submits the whole selection as multipliers in one batch call, then navigates back', async () => {
  // A recipe with a known servingsCount and one without both submit as
  // plain chip-selected multipliers now — servingsCount no longer
  // changes how a recipe's multiplier is derived on this screen.
  mockedRecipesApi.fetchRecipes.mockResolvedValue([
    { id: 'r1', title: 'Herb Roast Chicken', servingsCount: 4 },
    { id: 'r2', title: 'Tacos', servingsCount: null },
  ]);

  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r2'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-scale-preset-r1-1.5'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-scale-preset-r2-2'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-submit'));

  await waitFor(() => expect(back).toHaveBeenCalled());
  expect(mockedThisWeekApi.addRecipesToThisWeek).toHaveBeenCalledTimes(1);
  expect(mockedThisWeekApi.addRecipesToThisWeek).toHaveBeenCalledWith('plan-1', [
    { recipeId: 'r1', multiplier: 1.5 },
    { recipeId: 'r2', multiplier: 2 },
  ]);
  expect(screen.getByText('Added 2 recipes to This Week')).toBeTruthy();
});

it('reports a failure without navigating back — the batch is all-or-nothing, no partial state to describe', async () => {
  mockedThisWeekApi.addRecipesToThisWeek.mockRejectedValue(new Error('boom'));

  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r2'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-submit'));

  await waitFor(() => expect(screen.getByText("Couldn't add those recipes")).toBeTruthy());
  expect(back).not.toHaveBeenCalled();
});

it('Cancel on the select step navigates back without adding anything', async () => {
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-back'));

  expect(back).toHaveBeenCalled();
  expect(mockedThisWeekApi.addRecipesToThisWeek).not.toHaveBeenCalled();
});
