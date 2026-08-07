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
    { id: 'r1', title: 'Herb Roast Chicken' },
    { id: 'r2', title: 'Tacos' },
  ]);
  mockedThisWeekApi.addRecipeToThisWeek.mockResolvedValue(undefined);
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

it('defaults servings to 4 and adjusts with the stepper', async () => {
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));

  expect(screen.getByText('4')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('add-to-this-week-servings-increment-r1'));
  expect(screen.getByText('5')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('add-to-this-week-servings-decrement-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-servings-decrement-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-servings-decrement-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-servings-decrement-r1'));
  // Never below 1.
  expect(screen.getByText('1')).toBeTruthy();
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

it('submits each selected recipe at its chosen servings, in order, then navigates back', async () => {
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r2'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-servings-increment-r2'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-submit'));

  await waitFor(() => expect(back).toHaveBeenCalled());
  expect(mockedThisWeekApi.addRecipeToThisWeek.mock.calls).toEqual([
    ['plan-1', 'r1', 4],
    ['plan-1', 'r2', 5],
  ]);
  expect(screen.getByText('Added 2 recipes to This Week')).toBeTruthy();
});

it('reports a partial failure without navigating back', async () => {
  mockedThisWeekApi.addRecipeToThisWeek
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('boom'));

  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r1'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-recipe-r2'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-next'));
  await fireEvent.press(screen.getByTestId('add-to-this-week-submit'));

  await waitFor(() =>
    expect(screen.getByText('Added 1 of 2 before running into a problem')).toBeTruthy(),
  );
  expect(back).not.toHaveBeenCalled();
});

it('Cancel on the select step navigates back without adding anything', async () => {
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('add-to-this-week-back'));

  expect(back).toHaveBeenCalled();
  expect(mockedThisWeekApi.addRecipeToThisWeek).not.toHaveBeenCalled();
});
