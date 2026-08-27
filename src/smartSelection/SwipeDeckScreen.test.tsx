import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Image } from 'react-native';
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
const replace = jest.fn();
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
  mockedUseRouter.mockReturnValue({ back, push, replace, dismissTo });
  mockedUseSession.mockReturnValue({ session: { user: { id: 'user-1' } } });
  mockedUseReducedMotion.mockReturnValue(false);
  mockedApi.getSelectionRound.mockResolvedValue(testRound());
  mockedApi.getMyDecisionsForRound.mockResolvedValue(new Map());
  mockedApi.recordSelectionDecision.mockResolvedValue(undefined);
  mockedApi.clearSelectionDecision.mockResolvedValue(undefined);
  mockedApi.cancelSelectionRound.mockResolvedValue(undefined);
  mockedApi.refillSelectionRound.mockResolvedValue({ addedCount: 0 });
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(deckCardDetails);
  mockedHeroImage.getHeroImageUrls.mockResolvedValue({});
  mockedHeroImage.getCachedHeroImageUrl.mockReturnValue(null);
  jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
});

it('shows a loading state, then an error state with retry on failure', async () => {
  mockedApi.getSelectionRound.mockRejectedValue(new Error('boom'));

  renderDeck();

  await waitFor(() => expect(screen.getByTestId('swipe-deck-load-error')).toBeTruthy());

  mockedApi.getSelectionRound.mockResolvedValue(testRound());
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
});

it('prefetches every resolved hero image url into the native cache before the deck renders', async () => {
  const detailsWithImages = new Map([
    [
      'r1',
      {
        title: 'Herb Roast Chicken',
        heroImagePath: 'household-1/chicken.jpg',
        totalTimeMinutes: 45,
      },
    ],
    ['r2', { title: 'Tacos', heroImagePath: 'household-1/tacos.jpg', totalTimeMinutes: 30 }],
    ['r3', { title: 'Sourdough Loaf', heroImagePath: null, totalTimeMinutes: null }],
  ]);
  const urlByPath: Record<string, string> = {
    'household-1/chicken.jpg': 'https://example.com/chicken.jpg',
    'household-1/tacos.jpg': 'https://example.com/tacos.jpg',
  };
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(detailsWithImages);
  mockedHeroImage.getHeroImageUrls.mockResolvedValue(urlByPath);
  mockedHeroImage.getCachedHeroImageUrl.mockImplementation((path) => urlByPath[path] ?? null);

  renderDeck();

  await waitFor(() => expect(screen.getByTestId('swipe-deck-card-image')).toBeTruthy());

  expect(Image.prefetch).toHaveBeenCalledWith('https://example.com/chicken.jpg');
  expect(Image.prefetch).toHaveBeenCalledWith('https://example.com/tacos.jpg');
  expect(Image.prefetch).toHaveBeenCalledTimes(2);
});

it('only blocks on the next 6 cards’ hero images, warming the rest in the background (Codex, PR #110)', async () => {
  const recipeIds = Array.from({ length: 7 }, (_, i) => `r${i + 1}`);
  const pathFor = (id: string) => `household-1/${id}.jpg`;
  const urlFor = (id: string) => `https://example.com/${id}.jpg`;
  const detailsWithImages = new Map(
    recipeIds.map((id) => [id, { title: id, heroImagePath: pathFor(id), totalTimeMinutes: 30 }]),
  );
  const urlByPath = Object.fromEntries(recipeIds.map((id) => [pathFor(id), urlFor(id)]));
  mockedApi.getSelectionRound.mockResolvedValue(
    testRound({
      candidates: recipeIds.map((id, position) => ({
        recipeId: id,
        score: 10,
        reasonCodes: [],
        position,
      })),
    }),
  );
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(detailsWithImages);
  mockedHeroImage.getHeroImageUrls.mockResolvedValue(urlByPath);
  mockedHeroImage.getCachedHeroImageUrl.mockImplementation((path) => urlByPath[path] ?? null);
  // The 7th card falls outside the blocking window — a prefetch for it
  // that never settles must not stop the deck from rendering.
  jest
    .spyOn(Image, 'prefetch')
    .mockImplementation((url) =>
      url === urlFor('r7') ? new Promise(() => {}) : Promise.resolve(true),
    );

  renderDeck();

  await waitFor(() => expect(screen.getByTestId('swipe-deck-card-image')).toBeTruthy());

  for (let i = 1; i <= 6; i++) {
    expect(Image.prefetch).toHaveBeenCalledWith(urlFor(`r${i}`));
  }
  // Fired in the background rather than skipped, even though its own
  // promise is still pending.
  expect(Image.prefetch).toHaveBeenCalledWith(urlFor('r7'));
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

it('shows a minimal terminal state with zero yeses, and Done for now returns to This Week', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  expect(screen.getByText('No picks this round')).toBeTruthy();
  // Nothing to shortlist with zero yeses — no auto-navigation, no
  // "Continue" — only Undo/Start over/Done for now.
  expect(replace).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('swipe-deck-done'));
  expect(back).toHaveBeenCalled();
});

it('Start over cancels the round and dismisses the whole stack back to This Week (developer feedback, 2026-08-27)', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-start-over'));

  await waitFor(() => expect(mockedApi.cancelSelectionRound).toHaveBeenCalledWith('round-1'));
  expect(dismissTo).toHaveBeenCalledWith('/');
});

it('Start over shows a retryable error and stays put if cancelling fails', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  mockedApi.cancelSelectionRound.mockRejectedValue(new Error('offline'));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-start-over'));

  await waitFor(() => expect(screen.getByText("Couldn't start over — try again")).toBeTruthy());
  expect(dismissTo).not.toHaveBeenCalled();
});

it('Select more appends fresh candidates and continues the deck in place (ADR-0027 decision 2b)', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());

  // load()'s second call must reflect the caller's actual prior decisions
  // (all three already 'no') and the newly appended fourth candidate —
  // this is what makes "first undecided candidate" resume land past the
  // old end with zero new logic in load() itself.
  mockedApi.getMyDecisionsForRound.mockResolvedValue(
    new Map([
      ['r1', { decision: 'no', decidedAt: '2026-08-25T00:00:01.000Z' }],
      ['r2', { decision: 'no', decidedAt: '2026-08-25T00:00:02.000Z' }],
      ['r3', { decision: 'no', decidedAt: '2026-08-25T00:00:03.000Z' }],
    ]),
  );
  mockedApi.getSelectionRound.mockResolvedValue(
    testRound({
      targetCount: 10,
      candidates: [
        { recipeId: 'r1', score: 10, reasonCodes: ['never_planned'], position: 0 },
        { recipeId: 'r2', score: 8, reasonCodes: [], position: 1 },
        { recipeId: 'r3', score: 5, reasonCodes: ['diversity'], position: 2 },
        { recipeId: 'r4', score: 6, reasonCodes: [], position: 3 },
      ],
    }),
  );
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(
    new Map([
      ...deckCardDetails,
      ['r4', { title: 'Grilled Salmon', heroImagePath: null, totalTimeMinutes: 20 }],
    ]),
  );
  mockedApi.refillSelectionRound.mockResolvedValueOnce({ addedCount: 1 });

  await fireEvent.press(screen.getByTestId('swipe-deck-select-more'));

  expect(mockedApi.refillSelectionRound).toHaveBeenCalledWith('round-1');
  await waitFor(() => expect(screen.getByText('Grilled Salmon')).toBeTruthy());
  expect(screen.queryByTestId('swipe-deck-terminal')).toBeNull();
  expect(screen.getByText('4 of 4')).toBeTruthy();
});

it('Select more waits for an in-flight decision write before reloading (Codex, PR #108)', async () => {
  // The last card is swiped moments before this button is reachable, so
  // its recordSelectionDecision is routinely still pending. Reloading
  // then would let getMyDecisionsForRound miss that write and reopen the
  // card as undecided, letting a second vote race the first.
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  let resolveLastWrite: (() => void) | undefined;
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());

  // Hold only the final card's write open.
  mockedApi.recordSelectionDecision.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveLastWrite = resolve;
      }),
  );
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());

  mockedApi.refillSelectionRound.mockResolvedValueOnce({ addedCount: 1 });
  // Deliberately not awaited: the handler is blocked on the pending
  // write, so awaiting the press here would deadlock the test against
  // the very thing it's asserting.
  fireEvent.press(screen.getByTestId('swipe-deck-select-more'));
  await Promise.resolve();

  // The pending write gates everything — refill must not have fired yet.
  expect(mockedApi.refillSelectionRound).not.toHaveBeenCalled();

  resolveLastWrite!();

  await waitFor(() => expect(mockedApi.refillSelectionRound).toHaveBeenCalledWith('round-1'));
});

it('Select more shows a toast and stays on the terminal state when there is nothing left to add', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  mockedApi.refillSelectionRound.mockResolvedValueOnce({ addedCount: 0 });
  const getSelectionRoundCallsBefore = mockedApi.getSelectionRound.mock.calls.length;

  await fireEvent.press(screen.getByTestId('swipe-deck-select-more'));

  await waitFor(() =>
    expect(screen.getByText('No more recipes to suggest right now')).toBeTruthy(),
  );
  expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy();
  // addedCount: 0 must not trigger a re-load — nothing changed to reload.
  expect(mockedApi.getSelectionRound.mock.calls.length).toBe(getSelectionRoundCallsBefore);
});

it('Select more shows a retryable error and stays on the terminal state if it fails', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  await waitFor(() => expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy());
  mockedApi.refillSelectionRound.mockRejectedValueOnce(new Error('offline'));

  await fireEvent.press(screen.getByTestId('swipe-deck-select-more'));

  await waitFor(() =>
    expect(screen.getByText("Couldn't get more suggestions — try again")).toBeTruthy(),
  );
  expect(screen.getByTestId('swipe-deck-terminal')).toBeTruthy();
});

it('exhausting the deck with at least one yes navigates straight to the shortlist, replacing the deck in the stack', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  // No terminal "That's the deck" step, no "Continue" click needed —
  // exhausting the deck with a yes navigates immediately (developer
  // live-walkthrough feedback, 2026-08-26: the intermediate terminal
  // screen's placeholder-feeling copy and unclear Continue-vs-Done
  // choice were the "too many clicks" complaint).
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/smart-selection/round-1/shortlist'));
  // replace, not push — this deck has nothing left to resume.
  expect(push).not.toHaveBeenCalledWith(expect.stringContaining('/shortlist'));
});

it('does not navigate away while a decision write is still pending, and does once it resolves (Codex, PR #107)', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ targetCount: 10 }));
  const resolvers: (() => void)[] = [];
  mockedApi.recordSelectionDecision.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  renderDeck();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-yes'));
  await waitFor(() => expect(screen.getByText('Tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));
  await waitFor(() => expect(screen.getByText('Sourdough Loaf')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('swipe-deck-no'));

  // The deck is exhausted with a yes, but none of the three writes above
  // have resolved yet — replacing now would risk ShortlistScreen reading
  // decisions before the server has them (Codex, PR #107).
  expect(screen.getByTestId('swipe-deck-advancing')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();

  resolvers.forEach((resolve) => resolve());

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/smart-selection/round-1/shortlist'));
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
