import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import type { SelectionRound, SelectionRoundResults } from './api';
import * as deckCards from './deckCards';
import { ResultsScreen } from './ResultsScreen';
import { ToastProvider } from '../components/Toast';
import { trackEvent } from '../observability';
import { useSession } from '../session/SessionProvider';

jest.mock('./api');
jest.mock('./deckCards');
jest.mock('../observability', () => ({ trackEvent: jest.fn() }));
// Keeps the latest focus effect so a test can leave and come back.
let mockFocusEffect: (() => (() => void) | void) | null = null;
let mockFocusCleanup: (() => void) | void = undefined;
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn((effect: () => (() => void) | void) => {
    const { useEffect } = jest.requireActual('react');
    mockFocusEffect = effect;
    useEffect(() => {
      mockFocusCleanup = effect();
      return mockFocusCleanup;
    }, [effect]);
  }),
}));
jest.mock('../session/SessionProvider', () => ({ useSession: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const mockedApi = api as jest.Mocked<typeof api>;
const mockedDeckCards = deckCards as jest.Mocked<typeof deckCards>;
const replace = jest.fn();
const push = jest.fn();
const dismissTo = jest.fn();

const alex = { userId: 'alex', displayName: 'Alex' };
const blair = { userId: 'blair', displayName: 'Blair' };
const casey = { userId: 'casey', displayName: 'Casey' };

function round(overrides: Partial<SelectionRound> = {}): SelectionRound {
  return {
    id: 'round-1',
    householdId: 'household-1',
    createdBy: 'alex',
    mode: 'group',
    mealsOnly: false,
    status: 'ready_for_review',
    targetCount: 4,
    closesAt: '2026-10-07T03:00:00.000Z',
    candidateStrategyVersion: 'heuristic-v1',
    revealedAt: '2026-10-06T12:00:00.000Z',
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    closedAt: '2026-10-06T12:00:00.000Z',
    appliedAt: null,
    appliedBy: null,
    appliedWeeklyPlanId: null,
    participants: [
      { ...alex, completedAt: 'x', decidedCount: 4, yesCount: 3 },
      { ...blair, completedAt: 'x', decidedCount: 4, yesCount: 2 },
      { ...casey, completedAt: null, decidedCount: 1, yesCount: 1 },
    ],
    candidates: ['tacos', 'soup', 'pasta', 'salmon'].map((recipeId, position) => ({
      recipeId,
      score: 1,
      reasonCodes: [],
      position,
    })),
    ...overrides,
  };
}

function results(overrides: Partial<SelectionRoundResults> = {}): SelectionRoundResults {
  return {
    roundId: 'round-1',
    status: 'ready_for_review',
    completedParticipantCount: 2,
    candidates: [
      {
        recipeId: 'tacos',
        yesCount: 2,
        completedParticipantCount: 2,
        category: 'unanimous',
        chosenBy: [alex, blair],
        passedBy: [],
      },
      {
        recipeId: 'soup',
        yesCount: 1,
        completedParticipantCount: 2,
        category: 'mixed',
        chosenBy: [alex],
        passedBy: [blair],
      },
      {
        recipeId: 'pasta',
        yesCount: 2,
        completedParticipantCount: 2,
        category: 'unanimous',
        chosenBy: [alex, blair],
        passedBy: [],
      },
      {
        recipeId: 'salmon',
        yesCount: 0,
        completedParticipantCount: 2,
        category: 'mixed',
        chosenBy: [],
        passedBy: [alex, blair],
      },
    ],
    ...overrides,
  };
}

const details = new Map(
  [
    ['tacos', 'Tacos'],
    ['soup', 'Lentil Soup'],
    ['pasta', 'Pasta'],
    ['salmon', 'Miso Salmon'],
  ].map(([id, title]) => [id!, { title: title!, heroImagePath: null, totalTimeMinutes: null }]),
);

function renderAs(userId: string) {
  (useSession as jest.Mock).mockReturnValue({ session: { user: { id: userId } } });
  return render(
    <ToastProvider>
      <ResultsScreen roundId="round-1" />
    </ToastProvider>,
  );
}

afterEach(() => {
  if (typeof mockFocusCleanup === 'function') mockFocusCleanup();
  mockFocusCleanup = undefined;
});

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ replace, push, dismissTo });
  mockedApi.getSelectionRound.mockResolvedValue(round());
  mockedApi.getSelectionRoundResults.mockResolvedValue(results());
  mockedApi.cancelSelectionRound.mockResolvedValue(undefined);
  mockedDeckCards.fetchDeckCardDetails.mockResolvedValue(details);
});

it('groups the matches, says the round closed with someone unfinished, and ticks only unanimous picks', async () => {
  await renderAs('blair');
  await waitFor(() => expect(screen.getByText('Your matches')).toBeTruthy());

  expect(screen.getByTestId('results-intro')).toHaveTextContent('Closed with 2 of 3 in.');
  expect(screen.getByText('Everyone wants this')).toBeTruthy();
  expect(screen.getByText('Mixed interest')).toBeTruthy();
  expect(screen.queryByText('Miso Salmon')).toBeNull();
  expect(screen.getAllByText('Alex and You')).toHaveLength(2);

  expect(screen.getByTestId('results-row-tacos')).toHaveProp('accessibilityState', {
    checked: true,
    disabled: false,
  });
  expect(screen.getByTestId('results-row-soup')).toHaveProp('accessibilityState', {
    checked: false,
    disabled: false,
  });
  expect(screen.getByText('Continue with 2')).toBeTruthy();
});

it('continues to review with the ticked picks in deck order', async () => {
  await renderAs('blair');
  await waitFor(() => expect(screen.getByTestId('results-row-soup')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('results-row-soup'));
  await fireEvent.press(screen.getByTestId('results-continue'));

  expect(push).toHaveBeenCalledWith('/smart-selection/round-1/review?recipeIds=tacos,soup,pasta');
});

it('cannot continue with nothing ticked', async () => {
  await renderAs('alex');
  await waitFor(() => expect(screen.getByTestId('results-row-tacos')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('results-row-tacos'));
  await fireEvent.press(screen.getByTestId('results-row-pasta'));

  expect(screen.getByText('Continue with 0')).toBeTruthy();
  expect(screen.getByTestId('results-continue')).toBeDisabled();
});

it('is honest when there are no strong matches, hiding single yeses until asked', async () => {
  mockedApi.getSelectionRoundResults.mockResolvedValue(
    results({
      candidates: [
        {
          recipeId: 'soup',
          yesCount: 1,
          completedParticipantCount: 2,
          category: 'mixed',
          chosenBy: [alex],
          passedBy: [blair],
        },
      ],
    }),
  );
  await renderAs('alex');
  await waitFor(() => expect(screen.getByText('No strong matches')).toBeTruthy());

  expect(screen.queryByText('Lentil Soup')).toBeNull();
  await fireEvent.press(screen.getByTestId('results-show-mixed'));
  expect(screen.getByText('Lentil Soup')).toBeTruthy();
  expect(screen.queryByTestId('results-show-mixed')).toBeNull();
});

it('drops the list and the continue button when nobody picked anything', async () => {
  mockedApi.getSelectionRoundResults.mockResolvedValue(
    results({ candidates: [results().candidates[3]!] }),
  );
  await renderAs('alex');
  await waitFor(() => expect(screen.getByTestId('results-empty')).toBeTruthy());

  expect(screen.queryByTestId('results-continue')).toBeNull();
  await fireEvent.press(screen.getByTestId('results-plan-by-hand'));
  await waitFor(() => expect(mockedApi.cancelSelectionRound).toHaveBeenCalledWith('round-1'));
  expect(dismissTo).toHaveBeenCalledWith('/');
});

it('always lets the household set an unwanted round aside', async () => {
  await renderAs('alex');
  await waitFor(() => expect(screen.getByText('Your matches')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('results-plan-by-hand'));
  await waitFor(() => expect(mockedApi.cancelSelectionRound).toHaveBeenCalledWith('round-1'));
  expect(dismissTo).toHaveBeenCalledWith('/');
});

it('with only one clear match, keeps single picks behind a button', async () => {
  mockedApi.getSelectionRoundResults.mockResolvedValue(
    results({ candidates: [results().candidates[0]!, results().candidates[1]!] }),
  );
  await renderAs('alex');
  await waitFor(() => expect(screen.getByText('Only one clear match')).toBeTruthy());

  expect(screen.queryByText('Lentil Soup')).toBeNull();
  await fireEvent.press(screen.getByTestId('results-show-mixed'));
  expect(screen.getByText('Lentil Soup')).toBeTruthy();
});

it('keeps changed ticks and reports the results once when coming back from review', async () => {
  await renderAs('blair');
  await waitFor(() => expect(screen.getByTestId('results-row-soup')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('results-row-soup'));

  await act(async () => {
    if (typeof mockFocusCleanup === 'function') mockFocusCleanup();
    mockFocusCleanup = mockFocusEffect!();
  });
  await waitFor(() => expect(mockedApi.getSelectionRound).toHaveBeenCalledTimes(2));

  expect(screen.getByTestId('results-row-soup')).toHaveProp('accessibilityState', {
    checked: true,
    disabled: false,
  });
  expect(
    (trackEvent as jest.Mock).mock.calls.filter(([name]) => name === 'selection_results_viewed'),
  ).toEqual([['selection_results_viewed', { unanimous: 2, majority: 0, mixed: 1 }]]);
});

it('reloads when setting the round aside fails, e.g. someone just added it', async () => {
  mockedApi.cancelSelectionRound.mockRejectedValue(new Error('selection round is not cancellable'));
  await renderAs('alex');
  await waitFor(() => expect(screen.getByTestId('results-plan-by-hand')).toBeTruthy());

  mockedApi.getSelectionRound.mockResolvedValue(round({ status: 'applied', appliedBy: 'blair' }));
  await fireEvent.press(screen.getByTestId('results-plan-by-hand'));

  await waitFor(() => expect(screen.getByText('Added to This Week')).toBeTruthy());
  expect(screen.getByText("Couldn't set the round aside — try again")).toBeTruthy();
});

it('says so when nobody finished, rather than that nobody picked anything', async () => {
  mockedApi.getSelectionRoundResults.mockResolvedValue(
    results({ completedParticipantCount: 0, candidates: [] }),
  );
  await renderAs('alex');
  await waitFor(() => expect(screen.getByTestId('results-empty')).toBeTruthy());
  expect(screen.getByText('Nobody finished, so no picks counted.')).toBeTruthy();
  expect(trackEvent).toHaveBeenCalledWith('selection_no_match');
});

it('shows an applied round read-only, saying who added it', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(round({ status: 'applied', appliedBy: 'alex' }));
  mockedApi.getSelectionRoundResults.mockResolvedValue(results({ status: 'applied' }));
  await renderAs('blair');

  await waitFor(() => expect(screen.getByText('Added to This Week')).toBeTruthy());
  expect(screen.getByTestId('results-intro')).toHaveTextContent(
    'Alex added picks from this round to This Week.',
  );
  expect(screen.queryByTestId('results-continue')).toBeNull();
  expect(screen.getByTestId('results-row-tacos')).toBeDisabled();
});

it('sends a round that is still open back to the waiting screen', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(round({ status: 'active' }));
  await renderAs('alex');
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/smart-selection/round-1/waiting'));
  expect(mockedApi.getSelectionRoundResults).not.toHaveBeenCalled();
});

it('goes back to This Week for a cancelled round', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(round({ status: 'cancelled' }));
  await renderAs('alex');
  await waitFor(() => expect(dismissTo).toHaveBeenCalledWith('/'));
});
