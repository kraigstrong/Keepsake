import { fireEvent, render, screen } from '@testing-library/react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import * as api from './api';
import { LibraryScreen } from './LibraryScreen';

jest.mock('./api');
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  // useFocusEffect normally only re-runs on navigation focus events —
  // this test suite isn't inside a real navigator, so it's mocked to
  // behave like a plain mount-time effect instead.
  useFocusEffect: jest.fn((effect: () => void) => effect()),
}));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseFocusEffect = useFocusEffect as jest.Mock;

const push = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push });
  mockedUseFocusEffect.mockImplementation((effect: () => void) => effect());
});

it('shows an empty state with an add action when there are no recipes', async () => {
  mockedApi.fetchRecipes.mockResolvedValue([]);

  await render(<LibraryScreen />);

  expect(screen.getByTestId('library-placeholder')).toBeTruthy();

  await fireEvent.press(screen.getByText('Add a recipe'));
  expect(push).toHaveBeenCalledWith('/recipe/new');
});

it('lists recipes and navigates to a recipe on press', async () => {
  mockedApi.fetchRecipes.mockResolvedValue([
    { id: 'r1', title: 'Chili' },
    { id: 'r2', title: 'Tacos' },
  ]);

  await render(<LibraryScreen />);

  expect(screen.getByText('Chili')).toBeTruthy();
  expect(screen.getByText('Tacos')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('library-recipe-r1'));
  expect(push).toHaveBeenCalledWith('/recipe/r1');
});

it('shows an error state when the list fails to load', async () => {
  mockedApi.fetchRecipes.mockRejectedValue(new Error('network down'));

  await render(<LibraryScreen />);

  expect(screen.getByTestId('library-load-error')).toBeTruthy();
});
