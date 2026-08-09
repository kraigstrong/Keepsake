import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
// Jest's module-factory hoisting only allows referencing out-of-scope
// identifiers prefixed "mock" (case-insensitive) — see the Link stand-in
// inside jest.mock('expo-router', ...) below.
import { Text as MockText } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import * as api from './api';
import type { ThisWeekEntry, ThisWeekPlan } from './api';
import { ThisWeekScreen } from './ThisWeekScreen';
import { ToastProvider } from '../components/Toast';
import { useConnectivity } from '../connectivity/ConnectivityProvider';
import * as heroImage from '../recipes/heroImage';

jest.mock('./api');
jest.mock('../recipes/heroImage');
jest.mock('../connectivity/ConnectivityProvider', () => ({ useConnectivity: jest.fn() }));
// Real useFocusEffect only re-invokes its callback on a focus event, or
// when the memoized callback's identity changes while still focused
// (ThisWeekScreen.tsx relies on the latter for the isOnline -> load()
// wiring) — never on every unrelated re-render. This mock approximates
// that by only calling a *new* callback identity, instead of naively
// re-running on every render like LibraryScreen.test.tsx's simpler mock
// does; without this, an unrelated state update (e.g. the optimistic
// remove below) would re-trigger load() and clobber it with stale data.
let mockLastFocusEffect: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn((effect: () => void) => {
    if (effect !== mockLastFocusEffect) {
      mockLastFocusEffect = effect;
      effect();
    }
  }),
  // ScreenHeader (rendered by every branch of ThisWeekScreen) uses
  // expo-router's real Link for the Settings icon — this mock replaces
  // the whole module, so Link needs a stand-in too or it renders as
  // undefined.
  Link: ({ children, ...props }: { children: ReactNode }) => (
    <MockText {...props}>{children}</MockText>
  ),
}));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

function renderThisWeekScreen() {
  // GestureHandlerRootView mirrors app/_layout.tsx's real wrapper — the
  // gesture-handler v3 swipe-to-remove row (ReanimatedSwipeable) throws
  // without one in its ancestry, same as it would if this screen were
  // mounted outside the app root in production.
  return render(
    <GestureHandlerRootView>
      <ToastProvider>
        <ThisWeekScreen />
      </ToastProvider>
    </GestureHandlerRootView>,
  );
}

const mockedApi = api as jest.Mocked<typeof api>;
const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;
const mockedUseConnectivity = useConnectivity as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;

const push = jest.fn();

function entry(overrides: Partial<ThisWeekEntry> = {}): ThisWeekEntry {
  return {
    id: overrides.id ?? 'entry-1',
    recipeId: overrides.recipeId ?? 'recipe-1',
    title: overrides.title ?? 'Herb Roast Chicken',
    heroImagePath: overrides.heroImagePath ?? null,
    servings: overrides.servings ?? 4,
    position: overrides.position ?? 0,
  };
}

function plan(overrides: Partial<ThisWeekPlan> = {}): ThisWeekPlan {
  return {
    id: overrides.id ?? 'plan-1',
    status: overrides.status ?? 'planning',
    entries: overrides.entries ?? [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLastFocusEffect = null;
  mockedUseRouter.mockReturnValue({ push });
  mockedUseConnectivity.mockReturnValue({ isOnline: true });
  mockedHeroImage.getHeroImageUrl.mockResolvedValue(null);
  mockedApi.confirmThisWeek.mockResolvedValue(undefined);
  mockedApi.reopenThisWeek.mockResolvedValue(undefined);
  mockedApi.removeFromThisWeek.mockResolvedValue(undefined);
  mockedApi.reorderThisWeek.mockResolvedValue(undefined);
  mockedApi.addRecipeToThisWeek.mockResolvedValue(undefined);
});

it('shows an offline state and never fetches while offline', async () => {
  mockedUseConnectivity.mockReturnValue({ isOnline: false });

  await renderThisWeekScreen();

  expect(screen.getByTestId('this-week-offline')).toBeTruthy();
  expect(mockedApi.fetchCurrentWeeklyPlan).not.toHaveBeenCalled();
});

it('shows an error state with retry when the plan fails to load', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockRejectedValue(new Error('boom'));

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-load-error')).toBeTruthy());

  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(plan());
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  await waitFor(() => expect(screen.getByTestId('this-week-placeholder')).toBeTruthy());
});

it('shows the empty state with an Add recipes action', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(plan());

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-placeholder')).toBeTruthy());
  await fireEvent.press(screen.getByText('Add recipes'));

  expect(push).toHaveBeenCalledWith('/this-week/add?planId=plan-1');
});

it('renders planning rows with title and servings, and a Confirm Plan button', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ entries: [entry({ id: 'e1', title: 'Herb Roast Chicken', servings: 4 })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e1')).toBeTruthy());
  expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();
  expect(screen.getByText('Serves 4')).toBeTruthy();
  expect(screen.getByTestId('this-week-confirm-plan')).toBeTruthy();
});

it('shows an Add recipes button (same treatment as the empty state) once the plan has entries', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ entries: [entry({ id: 'e1', title: 'Herb Roast Chicken' })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-add-recipes')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-add-recipes'));

  expect(push).toHaveBeenCalledWith('/this-week/add?planId=plan-1');
});

it('confirms the plan optimistically, with no reload round-trip', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(plan({ entries: [entry({ id: 'e1' })] }));

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-confirm-plan')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-confirm-plan'));

  expect(screen.getByTestId('this-week-edit-plan')).toBeTruthy();
  await waitFor(() => expect(mockedApi.confirmThisWeek).toHaveBeenCalledWith('plan-1'));
  // Only the initial mount fetch — confirming no longer waits on a second one.
  expect(mockedApi.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(1);
});

it('reverts the optimistic confirm if the server call fails', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(plan({ entries: [entry({ id: 'e1' })] }));
  mockedApi.confirmThisWeek.mockRejectedValue(new Error('boom'));

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-confirm-plan')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-confirm-plan'));

  await waitFor(() => expect(screen.getByTestId('this-week-confirm-plan')).toBeTruthy());
  expect(screen.queryByTestId('this-week-edit-plan')).toBeNull();
});

it('removes an entry, shows an Undo banner, and restores it on Undo', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({
      entries: [entry({ id: 'e1', title: 'Herb Roast Chicken', recipeId: 'r1', servings: 4 })],
    }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-entry-remove-e1'));

  expect(mockedApi.removeFromThisWeek).toHaveBeenCalledWith('e1');
  expect(screen.queryByTestId('this-week-entry-e1')).toBeNull();
  expect(screen.getByTestId('this-week-undo-banner')).toBeTruthy();
  expect(screen.getByText('Removed Herb Roast Chicken')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('this-week-undo-button'));

  await waitFor(() =>
    expect(mockedApi.addRecipeToThisWeek).toHaveBeenCalledWith('plan-1', 'r1', 4),
  );
});

it('reverts the optimistic remove if the server call fails', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(plan({ entries: [entry({ id: 'e1' })] }));
  mockedApi.removeFromThisWeek.mockRejectedValue(new Error('boom'));

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-entry-remove-e1'));

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e1')).toBeTruthy());
  expect(screen.queryByTestId('this-week-undo-banner')).toBeNull();
});

it('moves an entry down and calls reorderThisWeek with the new order', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ entries: [entry({ id: 'e1' }), entry({ id: 'e2', title: 'Tacos' })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-entry-move-down-e1'));

  await waitFor(() =>
    expect(mockedApi.reorderThisWeek).toHaveBeenCalledWith('plan-1', ['e2', 'e1']),
  );
});

it('moves an entry up and calls reorderThisWeek with the new order', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ entries: [entry({ id: 'e1' }), entry({ id: 'e2', title: 'Tacos' })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e2')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-entry-move-up-e2'));

  await waitFor(() =>
    expect(mockedApi.reorderThisWeek).toHaveBeenCalledWith('plan-1', ['e2', 'e1']),
  );
});

it('disables move-up on the first entry and move-down on the last entry', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ entries: [entry({ id: 'e1' }), entry({ id: 'e2', title: 'Tacos' })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e1')).toBeTruthy());
  expect(screen.getByTestId('this-week-entry-move-up-e1').props.accessibilityState.disabled).toBe(
    true,
  );
  expect(screen.getByTestId('this-week-entry-move-down-e2').props.accessibilityState.disabled).toBe(
    true,
  );
  expect(screen.getByTestId('this-week-entry-move-down-e1').props.accessibilityState.disabled).toBe(
    false,
  );
});

it('shows confirmed rows with a chevron that navigate to the recipe, and an Edit Plan button', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ status: 'confirmed', entries: [entry({ id: 'e1', recipeId: 'r1' })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-entry-e1')).toBeTruthy());
  expect(screen.queryByTestId('this-week-confirm-plan')).toBeNull();
  expect(screen.queryByTestId('this-week-add-recipes')).toBeNull();
  expect(screen.queryByTestId('this-week-entry-move-up-e1')).toBeNull();

  await fireEvent.press(screen.getByTestId('this-week-entry-e1'));
  expect(push).toHaveBeenCalledWith('/recipe/r1');
});

it('navigates to the grocery review screen for the confirmed plan', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ id: 'plan-1', status: 'confirmed', entries: [entry({ id: 'e1' })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-review-groceries')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-review-groceries'));
  expect(push).toHaveBeenCalledWith('/groceries/plan-1');
});

it('reopens a confirmed plan optimistically via Edit Plan, with no reload round-trip', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ status: 'confirmed', entries: [entry({ id: 'e1' })] }),
  );

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-edit-plan')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-edit-plan'));

  expect(screen.getByTestId('this-week-confirm-plan')).toBeTruthy();
  await waitFor(() => expect(mockedApi.reopenThisWeek).toHaveBeenCalledWith('plan-1'));
  expect(mockedApi.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(1);
});

it('reverts the optimistic reopen if the server call fails', async () => {
  mockedApi.fetchCurrentWeeklyPlan.mockResolvedValue(
    plan({ status: 'confirmed', entries: [entry({ id: 'e1' })] }),
  );
  mockedApi.reopenThisWeek.mockRejectedValue(new Error('boom'));

  renderThisWeekScreen();

  await waitFor(() => expect(screen.getByTestId('this-week-edit-plan')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('this-week-edit-plan'));

  await waitFor(() => expect(screen.getByTestId('this-week-edit-plan')).toBeTruthy());
  expect(screen.queryByTestId('this-week-confirm-plan')).toBeNull();
});
