import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import * as api from './api';
import type { GroceryReviewItem } from './api';
import { GroceryReviewScreen } from './GroceryReviewScreen';
import { ToastProvider } from '../components/Toast';
import { useConnectivity } from '../connectivity/ConnectivityProvider';

jest.mock('./api');
jest.mock('../connectivity/ConnectivityProvider', () => ({ useConnectivity: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

// Same approximation as ThisWeekScreen.test.tsx: only calls a *new*
// callback identity, not naively on every render — otherwise an
// unrelated state update (the optimistic toggle below) would
// re-trigger load() and clobber it with stale mocked data.
let mockLastFocusEffect: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn((effect: () => void) => {
    if (effect !== mockLastFocusEffect) {
      mockLastFocusEffect = effect;
      effect();
    }
  }),
}));

function renderScreen() {
  return render(
    <ToastProvider>
      <GroceryReviewScreen planId="plan-1" />
    </ToastProvider>,
  );
}

const mockedApi = api as jest.Mocked<typeof api>;
const mockedUseConnectivity = useConnectivity as jest.Mock;

function item(overrides: Partial<GroceryReviewItem> = {}): GroceryReviewItem {
  return {
    itemHash: overrides.itemHash ?? 'hash-1',
    category: overrides.category ?? 'produce',
    isStaple: overrides.isStaple ?? false,
    amounts: overrides.amounts ?? ['1 onion'],
    sourceRecipeIds: overrides.sourceRecipeIds ?? ['recipe-1'],
    included: overrides.included ?? true,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLastFocusEffect = null;
  mockedUseConnectivity.mockReturnValue({ isOnline: true });
  mockedApi.setGroceryItemSelection.mockResolvedValue(undefined);
});

it('shows an offline state and never fetches while offline', async () => {
  mockedUseConnectivity.mockReturnValue({ isOnline: false });

  await renderScreen();

  expect(screen.getByTestId('grocery-review-offline')).toBeTruthy();
  expect(mockedApi.fetchGroceryReview).not.toHaveBeenCalled();
});

it('shows an error state with retry when the list fails to load', async () => {
  mockedApi.fetchGroceryReview.mockRejectedValue(new Error('boom'));

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-load-error')).toBeTruthy());

  mockedApi.fetchGroceryReview.mockResolvedValue({ planId: 'plan-1', items: [] });
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  await waitFor(() => expect(screen.getByTestId('grocery-review-list')).toBeTruthy());
});

it('groups items under their category header', async () => {
  mockedApi.fetchGroceryReview.mockResolvedValue({
    planId: 'plan-1',
    items: [
      item({ itemHash: 'onion', category: 'produce', amounts: ['3 onions'] }),
      item({ itemHash: 'chicken', category: 'meat', amounts: ['1 chicken breast'] }),
    ],
  });

  renderScreen();

  await waitFor(() => expect(screen.getByText('3 onions')).toBeTruthy());
  expect(screen.getByText('Produce')).toBeTruthy();
  expect(screen.getByText('Meat')).toBeTruthy();
  expect(screen.getByText('1 chicken breast')).toBeTruthy();
});

it('renders a staple as unchecked by default and a non-staple as checked', async () => {
  mockedApi.fetchGroceryReview.mockResolvedValue({
    planId: 'plan-1',
    items: [
      item({ itemHash: 'salt', category: 'pantry', isStaple: true, included: false }),
      item({ itemHash: 'onion', category: 'produce', isStaple: false, included: true }),
    ],
  });

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-item-salt')).toBeTruthy());
  expect(screen.getByTestId('grocery-review-item-salt').props.accessibilityState.checked).toBe(
    false,
  );
  expect(screen.getByTestId('grocery-review-item-onion').props.accessibilityState.checked).toBe(
    true,
  );
});

it('toggles an item optimistically and calls setGroceryItemSelection', async () => {
  mockedApi.fetchGroceryReview.mockResolvedValue({
    planId: 'plan-1',
    items: [item({ itemHash: 'onion', included: true })],
  });

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-item-onion')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('grocery-review-item-onion'));

  expect(screen.getByTestId('grocery-review-item-onion').props.accessibilityState.checked).toBe(
    false,
  );
  await waitFor(() =>
    expect(mockedApi.setGroceryItemSelection).toHaveBeenCalledWith('plan-1', 'onion', false),
  );
});

it('reverts the optimistic toggle if the server call fails', async () => {
  mockedApi.fetchGroceryReview.mockResolvedValue({
    planId: 'plan-1',
    items: [item({ itemHash: 'onion', included: true })],
  });
  mockedApi.setGroceryItemSelection.mockRejectedValue(new Error('boom'));

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-item-onion')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('grocery-review-item-onion'));

  await waitFor(() =>
    expect(screen.getByTestId('grocery-review-item-onion').props.accessibilityState.checked).toBe(
      true,
    ),
  );
});
