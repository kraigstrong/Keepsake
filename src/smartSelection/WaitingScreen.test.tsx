import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Share } from 'react-native';

import * as api from './api';
import type { SelectionRound } from './api';
import { WaitingScreen } from './WaitingScreen';
import { ToastProvider } from '../components/Toast';
import { useSession } from '../session/SessionProvider';

jest.mock('./api');
let mockFocusCleanup: (() => void) | void = undefined;
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useFocusEffect: jest.fn((effect: () => (() => void) | void) => {
    const { useEffect } = jest.requireActual('react');
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
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseSession = useSession as jest.Mock;
const replace = jest.fn();
const dismissTo = jest.fn();

function groupRound(overrides: Partial<SelectionRound> = {}): SelectionRound {
  return {
    id: 'round-1',
    householdId: 'household-1',
    createdBy: 'alex',
    mode: 'group',
    mealsOnly: false,
    status: 'active',
    targetCount: 4,
    closesAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    candidateStrategyVersion: 'heuristic-v1',
    revealedAt: null,
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    closedAt: null,
    appliedAt: null,
    appliedBy: null,
    appliedWeeklyPlanId: null,
    participants: [
      {
        userId: 'alex',
        completedAt: '2026-10-06T11:00:00.000Z',
        displayName: 'Alex',
        decidedCount: 3,
        yesCount: 2,
      },
      { userId: 'blair', completedAt: null, displayName: 'Blair', decidedCount: 1, yesCount: 0 },
    ],
    candidates: [
      { recipeId: 'r1', score: 1, reasonCodes: [], position: 0 },
      { recipeId: 'r2', score: 1, reasonCodes: [], position: 1 },
      { recipeId: 'r3', score: 1, reasonCodes: [], position: 2 },
    ],
    ...overrides,
  };
}

function renderAs(userId: string) {
  mockedUseSession.mockReturnValue({ session: { user: { id: userId } } });
  return render(
    <ToastProvider>
      <WaitingScreen roundId="round-1" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ replace, dismissTo });
  mockedApi.getSelectionRound.mockResolvedValue(groupRound());
  mockedApi.closeSelectionRound.mockResolvedValue(undefined);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
});

afterEach(() => {
  if (typeof mockFocusCleanup === 'function') mockFocusCleanup();
  jest.useRealTimers();
});

it("shows each participant's progress, with you as You", async () => {
  await renderAs('alex');
  await waitFor(() => expect(screen.getByText('Waiting for everyone')).toBeTruthy());

  expect(screen.getByText('You')).toBeTruthy();
  expect(screen.getByText('Finished · 2 yes')).toBeTruthy();
  expect(screen.getByText('Blair')).toBeTruthy();
  expect(screen.getByText('1 of 3')).toBeTruthy();
});

it('lets the creator close early, saying who would be left out', async () => {
  await renderAs('alex');
  await waitFor(() => expect(screen.getByTestId('waiting-close-early-note')).toBeTruthy());
  expect(
    screen.getByText("Blair hasn't finished. Closing now means their picks won't count."),
  ).toBeTruthy();
  expect(screen.getByText(/Closes tomorrow at .*, or when you close it\./)).toBeTruthy();

  await fireEvent.press(screen.getByTestId('waiting-close'));

  await waitFor(() => expect(mockedApi.closeSelectionRound).toHaveBeenCalledWith('round-1'));
  expect(replace).toHaveBeenCalledWith('/smart-selection/round-1/results');
});

it('does not let anyone else close it, and says who can', async () => {
  await renderAs('blair');
  await waitFor(() => expect(screen.getByText('Waiting for everyone')).toBeTruthy());

  expect(screen.queryByTestId('waiting-close')).toBeNull();
  expect(screen.queryByTestId('waiting-close-early-note')).toBeNull();
  expect(
    screen.getByText(/Alex can close it early\. Otherwise it closes tomorrow at/),
  ).toBeTruthy();
});

it('reloads instead of stranding the creator when closing fails', async () => {
  mockedApi.closeSelectionRound.mockRejectedValue(new Error('selection round is not active'));
  await renderAs('alex');
  await waitFor(() => expect(screen.getByTestId('waiting-close')).toBeTruthy());

  mockedApi.getSelectionRound.mockResolvedValue(groupRound({ status: 'ready_for_review' }));
  await fireEvent.press(screen.getByTestId('waiting-close'));

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/smart-selection/round-1/results'));
  expect(screen.getByText("Couldn't close the round")).toBeTruthy();
});

it('reminds through the share sheet, and offers Nudge everyone only while someone is unfinished', async () => {
  await renderAs('alex');
  await waitFor(() => expect(screen.getByTestId('waiting-remind-blair')).toBeTruthy());
  expect(screen.queryByTestId('waiting-remind-alex')).toBeNull();

  await fireEvent.press(screen.getByTestId('waiting-remind-blair'));
  expect(Share.share).toHaveBeenCalledWith({
    message: expect.stringMatching(
      /^Still time to pick this week's meals in Keepsake — the round closes tomorrow at/,
    ),
  });
  await fireEvent.press(screen.getByTestId('waiting-nudge'));
  expect(Share.share).toHaveBeenCalledTimes(2);
});

it('hides reminders once everyone else has finished', async () => {
  const everyoneDone = groupRound();
  everyoneDone.participants[1] = { ...everyoneDone.participants[1]!, completedAt: 'x' };
  mockedApi.getSelectionRound.mockResolvedValue(everyoneDone);
  await renderAs('alex');
  await waitFor(() => expect(screen.getByText('Waiting for everyone')).toBeTruthy());

  expect(screen.queryByTestId('waiting-nudge')).toBeNull();
  expect(screen.queryByTestId('waiting-close-early-note')).toBeNull();
  expect(screen.getByTestId('waiting-close')).toBeTruthy();
});

it('offers Keep swiping to anyone who left cards undecided, and not otherwise', async () => {
  await renderAs('blair');
  await waitFor(() => expect(screen.getByTestId('waiting-keep-swiping')).toBeTruthy());
  expect(screen.getByText('Keep going')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('waiting-keep-swiping'));
  expect(replace).toHaveBeenCalledWith('/smart-selection/round-1');
});

it('shows no Keep swiping to someone who decided every card', async () => {
  await renderAs('alex');
  await waitFor(() => expect(screen.getByText('Waiting for everyone')).toBeTruthy());
  expect(screen.queryByTestId('waiting-keep-swiping')).toBeNull();
});

it('lets a member outside the round watch, without swiping or closing', async () => {
  await renderAs('casey');
  await waitFor(() => expect(screen.getByText('Picking meals')).toBeTruthy());

  expect(screen.queryByTestId('waiting-keep-swiping')).toBeNull();
  expect(screen.queryByTestId('waiting-close')).toBeNull();
  expect(screen.getByText('Alex')).toBeTruthy();
});

it('moves to the results once the round has closed', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(groupRound({ status: 'ready_for_review' }));
  await renderAs('blair');
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/smart-selection/round-1/results'));
});

it('goes back to This Week if the round was cancelled', async () => {
  mockedApi.getSelectionRound.mockResolvedValue(groupRound({ status: 'cancelled' }));
  await renderAs('blair');
  await waitFor(() => expect(dismissTo).toHaveBeenCalledWith('/'));
});

it('refreshes every 20 seconds while on screen', async () => {
  jest.useFakeTimers();
  await renderAs('alex');
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockedApi.getSelectionRound).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  expect(mockedApi.getSelectionRound).toHaveBeenCalledTimes(2);

  mockedApi.getSelectionRound.mockResolvedValue(groupRound({ status: 'ready_for_review' }));
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  expect(replace).toHaveBeenCalledWith('/smart-selection/round-1/results');
});
