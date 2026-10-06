import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import type { SelectionRound } from './api';
import * as deckCards from './deckCards';
import { ReviewScreen } from './ReviewScreen';
import { ToastProvider } from '../components/Toast';
import { useSession } from '../session/SessionProvider';
import * as thisWeekApi from '../thisWeek/api';

jest.mock('./api');
jest.mock('./deckCards');
jest.mock('../thisWeek/api');
jest.mock('../session/SessionProvider', () => ({ useSession: jest.fn() }));
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
jest.mock('../supabase/instance', () => ({ supabase: {} }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

function renderScreen(recipeIds = ['r1', 'r2']) {
  return render(
    <ToastProvider>
      <ReviewScreen roundId="round-1" recipeIds={recipeIds} />
    </ToastProvider>,
  );
}

const mockedApi = api as jest.Mocked<typeof api>;
const mockedDeckCards = deckCards as jest.Mocked<typeof deckCards>;
const mockedThisWeekApi = thisWeekApi as jest.Mocked<typeof thisWeekApi>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseSession = useSession as jest.Mock;

const back = jest.fn();
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
    mealsOnly: false,
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
  mockedUseRouter.mockReturnValue({ back, dismissTo });
  mockedUseSession.mockReturnValue({ session: { user: { id: 'user-1' } } });
  mockedThisWeekApi.fetchCurrentWeeklyPlan.mockResolvedValue({
    id: 'plan-1',
    status: 'planning',
    entries: [],
  });
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(deckCardDetails);
  mockedApi.getSelectionRound.mockResolvedValue(testRound());
  // Both r1/r2 are genuine 'yes' decisions by default — the shape
  // ReviewScreen re-derives recipeIds against (Codex, PR #106).
  mockedApi.getMyDecisionsForRound.mockResolvedValue(
    new Map([
      ['r1', { decision: 'yes' as const, decidedAt: '2026-08-26T00:00:01.000Z' }],
      ['r2', { decision: 'yes' as const, decidedAt: '2026-08-26T00:00:02.000Z' }],
    ]),
  );
  mockedApi.closeSelectionRound.mockResolvedValue(undefined);
  mockedApi.applySelectionRound.mockResolvedValue({ appliedBy: 'user-1' });
});

it('shows an error state when loading the plan/details fails', async () => {
  mockedThisWeekApi.fetchCurrentWeeklyPlan.mockRejectedValue(new Error('boom'));

  renderScreen();

  await waitFor(() => expect(screen.getByTestId('review-load-error')).toBeTruthy());
});

it('renders the shortlisted items via ServingsConfirmationStep, default multiplier 1', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.getByText('Tacos')).toBeTruthy();
  expect(screen.getByTestId('review-scale-preset-r1-1').props.accessibilityState.selected).toBe(
    true,
  );
  expect(screen.getByText('Add 2 to This Week')).toBeTruthy();
});

it('happy path: an active round is closed, then applied, in order with the right args', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('review-submit'));

  await waitFor(() => expect(mockedApi.applySelectionRound).toHaveBeenCalled());

  expect(mockedApi.closeSelectionRound).toHaveBeenCalledWith('round-1');
  expect(mockedApi.applySelectionRound).toHaveBeenCalledWith('round-1', 'plan-1', [
    { recipeId: 'r1', multiplier: 1 },
    { recipeId: 'r2', multiplier: 1 },
  ]);
  // close must actually precede apply, not just both get called.
  const closeOrder = mockedApi.closeSelectionRound.mock.invocationCallOrder[0]!;
  const applyOrder = mockedApi.applySelectionRound.mock.invocationCallOrder[0]!;
  expect(closeOrder).toBeLessThan(applyOrder);
});

it('a resumed round already in ready_for_review skips the close call', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ status: 'ready_for_review' }));
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('review-submit'));

  await waitFor(() => expect(mockedApi.applySelectionRound).toHaveBeenCalled());
  expect(mockedApi.closeSelectionRound).not.toHaveBeenCalled();
});

it('an apply failure surfaces a retryable error and a retry does not re-call close', async () => {
  mockedApi.applySelectionRound.mockRejectedValueOnce(new Error('offline'));
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('review-submit'));

  await waitFor(() => expect(screen.getByText("Couldn't add those recipes")).toBeTruthy());
  expect(mockedApi.closeSelectionRound).toHaveBeenCalledTimes(1);
  expect(dismissTo).not.toHaveBeenCalled();

  // Retry: the round is now ready_for_review server-side (the first
  // close already succeeded), so this live re-check must skip close
  // rather than blindly retrying the whole sequence.
  mockedApi.getSelectionRound.mockResolvedValue(testRound({ status: 'ready_for_review' }));
  await fireEvent.press(screen.getByTestId('review-submit'));

  await waitFor(() => expect(mockedApi.applySelectionRound).toHaveBeenCalledTimes(2));
  expect(mockedApi.closeSelectionRound).toHaveBeenCalledTimes(1);
});

it('on success, toasts the added count and dismisses back to This Week', async () => {
  renderScreen();

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('review-submit'));

  await waitFor(() => expect(screen.getByText('Added 2 to This Week')).toBeTruthy());
  expect(dismissTo).toHaveBeenCalledWith('/');
});

it("re-derives recipeIds against the caller's actual yes decisions, dropping anything else", async () => {
  // r3 is in the route param but was never decided 'yes' (e.g. a
  // malformed/stale deep link, or an id from someone else's decisions —
  // Codex, PR #106: apply_selection_round only checks candidate
  // membership, not that the caller actually chose it).
  mockedApi.getMyDecisionsForRound.mockResolvedValue(
    new Map([
      ['r1', { decision: 'yes' as const, decidedAt: '2026-08-26T00:00:01.000Z' }],
      ['r2', { decision: 'no' as const, decidedAt: '2026-08-26T00:00:02.000Z' }],
    ]),
  );
  renderScreen(['r1', 'r2', 'r3']);

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.queryByText('Tacos')).toBeNull();
  expect(screen.getByText('Add 1 to This Week')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('review-submit'));
  await waitFor(() => expect(mockedApi.applySelectionRound).toHaveBeenCalled());
  expect(mockedApi.applySelectionRound).toHaveBeenCalledWith('round-1', 'plan-1', [
    { recipeId: 'r1', multiplier: 1 },
  ]);
});

it('shows an empty state and never calls close/apply when nothing survives re-derivation', async () => {
  mockedApi.getMyDecisionsForRound.mockResolvedValue(new Map());
  renderScreen(['r1', 'r2']);

  await waitFor(() => expect(screen.getByTestId('review-empty')).toBeTruthy());
  expect(screen.getByText('Nothing to review')).toBeTruthy();
  expect(mockedApi.closeSelectionRound).not.toHaveBeenCalled();
  expect(mockedApi.applySelectionRound).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('review-empty-back'));
  expect(back).toHaveBeenCalled();
});

it('uses singular phrasing for exactly one recipe', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(
    testRound({ candidates: [{ recipeId: 'r1', score: 10, reasonCodes: [], position: 0 }] }),
  );
  renderScreen(['r1']);

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.getByText('Add 1 to This Week')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('review-submit'));

  await waitFor(() => expect(screen.getByText('Added 1 to This Week')).toBeTruthy());
});

describe('group round (#242)', () => {
  const groupResults = {
    roundId: 'round-1',
    status: 'ready_for_review' as const,
    completedParticipantCount: 2,
    candidates: [
      {
        recipeId: 'r1',
        yesCount: 2,
        completedParticipantCount: 2,
        category: 'unanimous' as const,
        chosenBy: [],
        passedBy: [],
      },
      {
        recipeId: 'r2',
        yesCount: 1,
        completedParticipantCount: 2,
        category: 'mixed' as const,
        chosenBy: [],
        passedBy: [],
      },
      {
        recipeId: 'r3',
        yesCount: 0,
        completedParticipantCount: 2,
        category: 'mixed' as const,
        chosenBy: [],
        passedBy: [],
      },
    ],
  };

  beforeEach(() => {
    mockedApi.getSelectionRound.mockResolvedValue(
      testRound({ mode: 'group', status: 'ready_for_review' }),
    );
    mockedApi.getSelectionRoundResults.mockResolvedValue(groupResults);
    // The reviewer chose none of these themselves.
    mockedApi.getMyDecisionsForRound.mockResolvedValue(new Map());
  });

  it("accepts the group's matches whoever is reviewing, with why each was picked", async () => {
    renderScreen(['r1', 'r2']);

    await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
    expect(screen.getByText('Everyone wants this')).toBeTruthy();
    expect(screen.getByText('1 of 2 chose this')).toBeTruthy();
    expect(screen.getByText('Add 2 to This Week')).toBeTruthy();
  });

  it('drops anything nobody chose, even if the route asks for it', async () => {
    renderScreen(['r1', 'r3', 'not-a-candidate']);

    await waitFor(() => expect(screen.getByText('Add 1 to This Week')).toBeTruthy());
  });

  it('applies without trying to close the round, even one that reads active', async () => {
    renderScreen(['r1', 'r2']);
    await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());

    // The solo path closes an active round before applying; a group one
    // must not, since only its creator could and it's closed already.
    mockedApi.getSelectionRound.mockResolvedValue(testRound({ mode: 'group', status: 'active' }));
    await fireEvent.press(screen.getByTestId('review-submit'));

    await waitFor(() =>
      expect(mockedApi.applySelectionRound).toHaveBeenCalledWith('round-1', 'plan-1', [
        { recipeId: 'r1', multiplier: 1 },
        { recipeId: 'r2', multiplier: 1 },
      ]),
    );
    expect(mockedApi.closeSelectionRound).not.toHaveBeenCalled();
    expect(dismissTo).toHaveBeenCalledWith('/');
  });

  it('tells whoever lost a simultaneous add that it was already added', async () => {
    mockedApi.applySelectionRound.mockResolvedValue({ appliedBy: 'someone-else' });
    renderScreen(['r1']);
    await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('review-submit'));

    await waitFor(() => expect(screen.getByText('Already added to This Week')).toBeTruthy());
    expect(screen.queryByText('Added 1 to This Week')).toBeNull();
    expect(dismissTo).toHaveBeenCalledWith('/');
  });

  it('leaves quietly if the round was set aside meanwhile', async () => {
    renderScreen(['r1']);
    await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());

    mockedApi.getSelectionRound.mockResolvedValue(
      testRound({ mode: 'group', status: 'cancelled' }),
    );
    await fireEvent.press(screen.getByTestId('review-submit'));

    await waitFor(() => expect(screen.getByText('That round was set aside')).toBeTruthy());
    expect(mockedApi.applySelectionRound).not.toHaveBeenCalled();
  });

  it('tells the second person to arrive that it was already added', async () => {
    renderScreen(['r1']);
    await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());

    mockedApi.getSelectionRound.mockResolvedValue(testRound({ mode: 'group', status: 'applied' }));
    await fireEvent.press(screen.getByTestId('review-submit'));

    await waitFor(() => expect(screen.getByText('Already added to This Week')).toBeTruthy());
    expect(mockedApi.applySelectionRound).not.toHaveBeenCalled();
    expect(dismissTo).toHaveBeenCalledWith('/');
  });
});
