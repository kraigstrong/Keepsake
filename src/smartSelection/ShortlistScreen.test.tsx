import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import type { SelectionRound } from './api';
import * as deckCards from './deckCards';
import { ShortlistScreen } from './ShortlistScreen';
import { ToastProvider } from '../components/Toast';
import { useSession } from '../session/SessionProvider';

jest.mock('./api');
jest.mock('./deckCards');
let mockLastFocusEffect: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn((effect: () => void) => {
    if (effect !== mockLastFocusEffect) {
      mockLastFocusEffect = effect;
      effect();
    }
  }),
}));
jest.mock('../session/SessionProvider', () => ({ useSession: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

function renderScreen(roundId = 'round-1') {
  return render(
    <ToastProvider>
      <ShortlistScreen roundId={roundId} />
    </ToastProvider>,
  );
}

const mockedApi = api as jest.Mocked<typeof api>;
const mockedDeckCards = deckCards as jest.Mocked<typeof deckCards>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseSession = useSession as jest.Mock;

const back = jest.fn();
const push = jest.fn();
const dismissTo = jest.fn();

function testRound(overrides: Partial<SelectionRound> = {}): SelectionRound {
  return {
    id: 'round-1',
    householdId: 'household-1',
    createdBy: 'user-1',
    mode: 'solo',
    status: 'active',
    targetCount: 2,
    closesAt: null,
    candidateStrategyVersion: 'heuristic-v1',
    revealedAt: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    closedAt: null,
    appliedAt: null,
    appliedBy: null,
    appliedWeeklyPlanId: null,
    participants: [],
    candidates: [
      { recipeId: 'r1', score: 10, reasonCodes: [], position: 0 },
      { recipeId: 'r2', score: 8, reasonCodes: [], position: 1 },
      { recipeId: 'r3', score: 5, reasonCodes: [], position: 2 },
      { recipeId: 'r4', score: 3, reasonCodes: [], position: 3 },
    ],
    ...overrides,
  };
}

const deckCardDetails = new Map([
  ['r1', { title: 'Herb Roast Chicken', heroImagePath: null, totalTimeMinutes: 45 }],
  ['r2', { title: 'Tacos', heroImagePath: null, totalTimeMinutes: 30 }],
]);

beforeEach(() => {
  jest.clearAllMocks();
  mockLastFocusEffect = null;
  mockedUseRouter.mockReturnValue({ back, push, dismissTo });
  mockedUseSession.mockReturnValue({ session: { user: { id: 'user-1' } } });
  mockedApi.getSelectionRound.mockResolvedValue(testRound());
  mockedApi.cancelSelectionRound.mockResolvedValue(undefined);
  mockedApi.getMyDecisionsForRound.mockResolvedValue(
    new Map([
      ['r1', { decision: 'yes' as const, decidedAt: '2026-08-26T00:00:01.000Z' }],
      ['r2', { decision: 'yes' as const, decidedAt: '2026-08-26T00:00:02.000Z' }],
    ]),
  );
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(deckCardDetails);
});

it('shows only the yes-decided candidates, all checked by default, in position order', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.getByText('Tacos')).toBeTruthy();
  expect(screen.getByTestId('shortlist-item-r1').props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('shortlist-item-r2').props.accessibilityState.checked).toBe(true);
  expect(screen.getByText('Continue with 2')).toBeTruthy();
});

it('unchecking an item lowers the Continue count and dims the row', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('shortlist-item-r1'));

  expect(screen.getByTestId('shortlist-item-r1').props.accessibilityState.checked).toBe(false);
  expect(screen.getByText('Continue with 1')).toBeTruthy();
});

it('reorder swaps the pressed item with its neighbor', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  const list = screen.getByTestId('shortlist-list');
  const titlesBefore = within(list)
    .getAllByText(/Herb Roast Chicken|Tacos/)
    .map((node) => node.props.children);
  expect(titlesBefore).toEqual(['Herb Roast Chicken', 'Tacos']);

  await fireEvent.press(screen.getByTestId('shortlist-item-move-down-r1'));

  const titlesAfter = within(list)
    .getAllByText(/Herb Roast Chicken|Tacos/)
    .map((node) => node.props.children);
  expect(titlesAfter).toEqual(['Tacos', 'Herb Roast Chicken']);
});

it('disables Continue once every item is unchecked', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('shortlist-item-r1'));
  await fireEvent.press(screen.getByTestId('shortlist-item-r2'));

  expect(screen.getByText('Continue with 0')).toBeTruthy();
  expect(screen.getByTestId('shortlist-continue').props.accessibilityState.disabled).toBe(true);
});

it('shows "Keep browsing" for the undecided remainder, and it navigates back to the deck', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  // 4 candidates total, 2 decided (both yes) -> 2 remaining.
  expect(screen.getByText('Keep browsing the remaining 2')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('shortlist-keep-browsing'));

  expect(back).toHaveBeenCalled();
});

it('hides "Keep browsing" once the whole deck has been decided', async () => {
  mockedApi.getMyDecisionsForRound.mockResolvedValue(
    new Map([
      ['r1', { decision: 'yes' as const, decidedAt: '2026-08-26T00:00:01.000Z' }],
      ['r2', { decision: 'yes' as const, decidedAt: '2026-08-26T00:00:02.000Z' }],
      ['r3', { decision: 'no' as const, decidedAt: '2026-08-26T00:00:03.000Z' }],
      ['r4', { decision: 'no' as const, decidedAt: '2026-08-26T00:00:04.000Z' }],
    ]),
  );
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.queryByTestId('shortlist-keep-browsing')).toBeNull();
});

it('hides "Keep browsing" once the round has left \'active\', even with undecided candidates remaining', async () => {
  // A round resumed after Review's close succeeded but apply failed
  // (Codex, PR #106) — closing moves status to 'ready_for_review', and
  // record_selection_decision requires 'active', so offering to browse
  // more would just be a second dead end.
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ status: 'ready_for_review' }));
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.queryByTestId('shortlist-keep-browsing')).toBeNull();
});

it('Continue navigates to the review route with the ordered, checked-only recipe ids', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('shortlist-item-move-down-r1'));
  await fireEvent.press(screen.getByTestId('shortlist-continue'));

  expect(push).toHaveBeenCalledWith('/smart-selection/round-1/review?recipeIds=r2,r1');
});

it('Start over cancels the round and dismisses back to This Week (developer feedback, 2026-08-27)', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('shortlist-start-over'));

  await waitFor(() => expect(mockedApi.cancelSelectionRound).toHaveBeenCalledWith('round-1'));
  expect(dismissTo).toHaveBeenCalledWith('/');
});

it('Start over shows a retryable error and stays put if cancelling fails', async () => {
  mockedApi.cancelSelectionRound.mockRejectedValue(new Error('offline'));
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('shortlist-start-over'));

  await waitFor(() => expect(screen.getByText("Couldn't start over — try again")).toBeTruthy());
  expect(dismissTo).not.toHaveBeenCalled();
});
