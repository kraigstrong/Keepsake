import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import * as api from './api';
import type { SelectionRound } from './api';
import * as deckCards from './deckCards';
import { SwipeDeckScreen } from './SwipeDeckScreen';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import { ToastProvider } from '../components/Toast';
import * as heroImage from '../recipes/heroImage';
import { useSession } from '../session/SessionProvider';

jest.mock('./api');
jest.mock('./deckCards');
jest.mock('../recipes/heroImage');
jest.mock('../accessibility/useReducedMotion');
// Mirrors ThisWeekScreen.test.tsx's own useFocusEffect mock: only
// re-invokes on a genuinely new callback identity, so re-renders that
// don't change `load`'s identity (SwipeDeckScreen.tsx's useCallback deps
// are just [roundId, userId]) don't refire the load and clobber
// in-flight local state changes made by a test's button presses.
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

function renderDeck(roundId = 'round-1') {
  return render(
    <GestureHandlerRootView>
      <ToastProvider>
        <SwipeDeckScreen roundId={roundId} />
      </ToastProvider>
    </GestureHandlerRootView>,
  );
}

const mockedApi = api as jest.Mocked<typeof api>;
const mockedDeckCards = deckCards as jest.Mocked<typeof deckCards>;
const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseSession = useSession as jest.Mock;
const mockedUseReducedMotion = useReducedMotion as jest.Mock;

const back = jest.fn();
const push = jest.fn();

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
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    closedAt: null,
    appliedAt: null,
    appliedBy: null,
    appliedWeeklyPlanId: null,
    participants: [],
    candidates: [
      { recipeId: 'r1', score: 10, reasonCodes: ['never_planned'], position: 0 },
      { recipeId: 'r2', score: 8, reasonCodes: [], position: 1 },
      { recipeId: 'r3', score: 5, reasonCodes: ['diversity'], position: 2 },
    ],
    ...overrides,
  };
}

const deckCardDetails = new Map([
  ['r1', { title: 'Herb Roast Chicken', heroImagePath: null, totalTimeMinutes: 45 }],
  ['r2', { title: 'Tacos', heroImagePath: null, totalTimeMinutes: 30 }],
  ['r3', { title: 'Sourdough Loaf', heroImagePath: null, totalTimeMinutes: null }],
]);

beforeEach(() => {
  jest.clearAllMocks();
  mockLastFocusEffect = null;
  mockedUseRouter.mockReturnValue({ back, push });
  mockedUseSession.mockReturnValue({ session: { user: { id: 'user-1' } } });
  mockedUseReducedMotion.mockReturnValue(false);
  mockedApi.getSelectionRound.mockResolvedValue(testRound());
  mockedApi.getMyDecisionsForRound.mockResolvedValue(new Map());
  mockedApi.recordSelectionDecision.mockResolvedValue(undefined);
  mockedApi.clearSelectionDecision.mockResolvedValue(undefined);
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(deckCardDetails);
  mockedHeroImage.getHeroImageUrls.mockResolvedValue({});
  mockedHeroImage.getCachedHeroImageUrl.mockReturnValue(null);
});

it('shows a loading state, then an error state with retry on failure', async () => {
  mockedApi.getSelectionRound.mockRejectedValue(new Error('boom'));

  renderDeck();

  await waitFor(() => expect(screen.getByTestId('swipe-deck-load-error')).toBeTruthy());

  mockedApi.getSelectionRound.mockResolvedValue(testRound());
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
});

it('starts at the first card with a 0 yes count when nothing has been decided yet', async () => {
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.getByText('1 of 3')).toBeTruthy();
  expect(screen.getByText('0 yes')).toBeTruthy();
  expect(screen.getByTestId('swipe-deck-undo').props.accessibilityState.disabled).toBe(true);
});

it('Yes advances the card, updates the running yes count, and records the decision', async () => {
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));

  expect(mockedApi.recordSelectionDecision).toHaveBeenCalledWith('round-1', 'r1', 'yes');
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  expect(screen.getByText('1 yes')).toBeTruthy();
  expect(screen.getByText('2 of 3')).toBeTruthy();
  // Per 1e, the "Passed on {title}" banner is 'no'-only — a 'yes' isn't
  // something a user typically wants undone with the same urgency (see
  // SwipeDeckScreen.tsx's decide()). Pinned here since a mutation
  // removing that gate entirely (always show the banner) passed every
  // other test in this file unnoticed.
  expect(screen.queryByTestId('swipe-deck-passed-banner')).toBeNull();
});

it("Not this week advances the card, records a 'no' decision, and shows the passed banner", async () => {
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  expect(mockedApi.recordSelectionDecision).toHaveBeenCalledWith('round-1', 'r1', 'no');
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  expect(screen.getByText('0 yes')).toBeTruthy();
  expect(screen.getByText('Passed on Herb Roast Chicken')).toBeTruthy();
});

it('Undo reverses the last decision, calls clearSelectionDecision, and restores the yes count', async () => {
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  expect(screen.getByText('1 yes')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('swipe-deck-undo'));

  expect(mockedApi.clearSelectionDecision).toHaveBeenCalledWith('round-1', 'r1');
  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.getByText('0 yes')).toBeTruthy();
  expect(screen.getByText('1 of 3')).toBeTruthy();
});

it('shows the Review bar once the running yes count reaches the target, and tapping it navigates to the shortlist route', async () => {
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  expect(screen.queryByTestId('swipe-deck-review-bar')).toBeNull();

  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-review-bar')).toBeTruthy());
  expect(screen.getByText('Review 2 picks')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('swipe-deck-review-action'));

  // A real navigation, not a local terminal-state flip — the deck still
  // has an undecided card ('Sourdough Loaf'), so this must not just
  // flip a local flag that fakes reaching the end of the deck.
  expect(push).toHaveBeenCalledWith('/smart-selection/round-1/shortlist');
  expect(screen.queryByTestId('swipe-deck-terminal')).toBeNull();
});

it('shows the terminal state once the deck is exhausted, and Done for now returns to This Week', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  expect(screen.getByText("That's the deck")).toBeTruthy();
  expect(within(screen.getByTestId('swipe-deck-terminal')).getByText('0 yes')).toBeTruthy();
  // Nothing to shortlist with zero yeses — only Undo/Done for now show.
  expect(screen.queryByTestId('swipe-deck-continue')).toBeNull();

  await fireEvent.press(screen.getByTestId('swipe-deck-done'));
  expect(back).toHaveBeenCalled();
});

it('shows a "Continue with N picks" button in the terminal state when there is at least one yes, and it navigates to the shortlist route', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  expect(screen.getByText('Continue with 1 picks')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('swipe-deck-continue'));

  expect(push).toHaveBeenCalledWith('/smart-selection/round-1/shortlist');
});

it('keeps Undo reachable in the terminal state, and using it returns to the deck', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  const terminalUndo = screen.getByTestId('swipe-deck-terminal-undo');
  expect(terminalUndo.props.accessibilityState.disabled).toBe(false);

  await fireEvent.press(terminalUndo);

  expect(mockedApi.clearSelectionDecision).toHaveBeenCalledWith('round-1', 'r3');
  await waitFor(() => expect(screen.queryByTestId('swipe-deck-terminal')).toBeNull());
  expect(screen.getByText('Sourdough Loaf')).toBeTruthy();
});

it('Pause navigates back to This Week', async () => {
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-pause'));

  expect(back).toHaveBeenCalled();
});

it('resumes at the first undecided card with the yes count seeded from prior decisions', async () => {
  mockedApi.getMyDecisionsForRound.mockResolvedValue(
    new Map([['r1', { decision: 'yes', decidedAt: '2026-08-25T00:00:00.000Z' }]]),
  );

  renderDeck();

  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  expect(screen.queryByText('Herb Roast Chicken')).toBeNull();
  expect(screen.getByText('1 yes')).toBeTruthy();
  expect(screen.getByText('2 of 3')).toBeTruthy();
});

it('seeds the undo stack from resumed decisions, oldest first, so Undo reverses the most recent one', async () => {
  mockedApi.getMyDecisionsForRound.mockResolvedValue(
    new Map([
      ['r1', { decision: 'no', decidedAt: '2026-08-25T00:00:01.000Z' }],
      ['r2', { decision: 'yes', decidedAt: '2026-08-25T00:00:02.000Z' }],
    ]),
  );

  renderDeck();

  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  expect(screen.getByText('1 yes')).toBeTruthy();
  expect(screen.getByTestId('swipe-deck-undo').props.accessibilityState.disabled).toBe(false);

  // r2 (yes, decided later) reverses first, back to the card it belonged to.
  await fireEvent.press(screen.getByTestId('swipe-deck-undo'));

  expect(mockedApi.clearSelectionDecision).toHaveBeenCalledWith('round-1', 'r2');
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  expect(screen.getByText('0 yes')).toBeTruthy();
});

it('rolls back the optimistic state when recordSelectionDecision fails', async () => {
  let rejectRecord!: (error: Error) => void;
  mockedApi.recordSelectionDecision.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectRecord = reject;
    }),
  );
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));

  // Optimistic advance happens immediately, before the write has settled...
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  expect(screen.getByText('1 yes')).toBeTruthy();

  // ...then the failed write rolls the count, undo entry, and (since
  // nothing has advanced past it yet) the card itself back.
  rejectRecord(new Error('offline'));
  await waitFor(() =>
    expect(screen.getByText("Couldn't save that decision — you'll need to redo it")).toBeTruthy(),
  );
  expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();
  expect(screen.getByText('0 yes')).toBeTruthy();
  expect(screen.getByTestId('swipe-deck-undo').props.accessibilityState.disabled).toBe(true);
});

it('does not corrupt later progress when an earlier decision fails after the user has moved on', async () => {
  let rejectR1!: (error: Error) => void;
  mockedApi.recordSelectionDecision.mockImplementation((_roundId, recipeId) => {
    if (recipeId === 'r1') {
      return new Promise((_resolve, reject) => {
        rejectR1 = reject;
      });
    }
    return Promise.resolve(undefined);
  });
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes')); // r1 — write left pending
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes')); // r2 — succeeds, moves on
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  expect(screen.getByText('2 yes')).toBeTruthy();

  // r1's write now fails, after the user has already moved two cards past it.
  rejectR1(new Error('offline'));

  // r1's failure is reflected (only r2's yes counts)...
  await waitFor(() => expect(screen.getByText('1 yes')).toBeTruthy());
  // ...but r2's own advance is untouched: still on the third card, not
  // reverted back to r1 by a rollback that isn't scoped to just r1.
  expect(screen.getByText('3 of 3')).toBeTruthy();
  expect(screen.getByText('Sourdough Loaf')).toBeTruthy();
});

it('waits for the in-flight decision write to settle before clearing it on Undo', async () => {
  let resolveRecord!: () => void;
  mockedApi.recordSelectionDecision.mockReturnValue(
    new Promise((resolve) => {
      resolveRecord = () => resolve(undefined);
    }),
  );
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());

  const undoPromise = fireEvent.press(screen.getByTestId('swipe-deck-undo'));
  // clearSelectionDecision must not fire while the record call is still
  // pending — otherwise an out-of-order delivery could have the clear
  // (a no-op) land before the delayed record upserts the vote.
  expect(mockedApi.clearSelectionDecision).not.toHaveBeenCalled();

  resolveRecord();
  await undoPromise;
  await waitFor(() =>
    expect(mockedApi.clearSelectionDecision).toHaveBeenCalledWith('round-1', 'r1'),
  );
});
