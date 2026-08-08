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
  mockedApi.clearGroceryItemSelection.mockResolvedValue(undefined);
});

// Lets a test control exactly when an RPC call resolves, to exercise
// the pending-while-in-flight guard and the per-item rollback.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

it('shows a distinct message and retries when the plan is not confirmed', async () => {
  mockedApi.fetchGroceryReview.mockRejectedValue(new Error(api.GROCERY_REVIEW_PLAN_NOT_CONFIRMED));

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-not-confirmed')).toBeTruthy());
  expect(screen.queryByTestId('grocery-review-load-error')).toBeNull();

  mockedApi.fetchGroceryReview.mockResolvedValue({ planId: 'plan-1', items: [] });
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  await waitFor(() => expect(screen.getByTestId('grocery-review-list')).toBeTruthy());
});

it('calls clearGroceryItemSelection when a toggle returns an item to its computed default', async () => {
  // A staple whose included state was already overridden to true (away
  // from its default of false) — toggling it off returns it to default.
  mockedApi.fetchGroceryReview.mockResolvedValue({
    planId: 'plan-1',
    items: [item({ itemHash: 'salt', isStaple: true, included: true })],
  });

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-item-salt')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('grocery-review-item-salt'));

  await waitFor(() =>
    expect(mockedApi.clearGroceryItemSelection).toHaveBeenCalledWith('plan-1', 'salt'),
  );
  expect(mockedApi.setGroceryItemSelection).not.toHaveBeenCalled();
});

it('ignores a second press on the same item while its toggle is still pending', async () => {
  const { promise, resolve } = deferred<void>();
  mockedApi.setGroceryItemSelection.mockReturnValue(promise);
  mockedApi.fetchGroceryReview.mockResolvedValue({
    planId: 'plan-1',
    items: [item({ itemHash: 'onion', included: true })],
  });

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-item-onion')).toBeTruthy());
  // Not awaited: the mock's promise never resolves until `resolve()`
  // below, and this RNTL version's fireEvent awaits onPress's own
  // returned promise — awaiting it here would deadlock the test on its
  // own still-pending first press (see BulkImportRecipesScreen.test.tsx
  // for the same unawaited-press-while-pending pattern).
  fireEvent.press(screen.getByTestId('grocery-review-item-onion'));
  await waitFor(() => expect(mockedApi.setGroceryItemSelection).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByTestId('grocery-review-item-onion'));
  await Promise.resolve();
  expect(mockedApi.setGroceryItemSelection).toHaveBeenCalledTimes(1);

  resolve(undefined);
  await waitFor(() =>
    expect(screen.getByTestId('grocery-review-item-onion').props.accessibilityState.checked).toBe(
      false,
    ),
  );
});

it("reverts only the failed item's toggle, leaving a concurrent successful toggle intact", async () => {
  const onionCall = deferred<void>();
  mockedApi.setGroceryItemSelection.mockImplementation((_planId, itemHash) =>
    itemHash === 'onion' ? onionCall.promise : Promise.resolve(),
  );
  mockedApi.fetchGroceryReview.mockResolvedValue({
    planId: 'plan-1',
    items: [
      item({ itemHash: 'onion', included: true }),
      item({ itemHash: 'garlic', included: true }),
    ],
  });

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('grocery-review-item-onion')).toBeTruthy());
  fireEvent.press(screen.getByTestId('grocery-review-item-onion')); // pending, not awaited — see the test above
  await fireEvent.press(screen.getByTestId('grocery-review-item-garlic')); // resolves immediately

  await waitFor(() =>
    expect(screen.getByTestId('grocery-review-item-garlic').props.accessibilityState.checked).toBe(
      false,
    ),
  );

  onionCall.reject(new Error('boom'));

  await waitFor(() =>
    expect(screen.getByTestId('grocery-review-item-onion').props.accessibilityState.checked).toBe(
      true,
    ),
  );
  // garlic's successful optimistic update must survive onion's rollback.
  expect(screen.getByTestId('grocery-review-item-garlic').props.accessibilityState.checked).toBe(
    false,
  );
});
