import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import { StartRoundSheet } from './StartRoundSheet';
import { ToastProvider } from '../components/Toast';
import { FLAGS } from '../featureFlags/flags';
import * as householdApi from '../household/api';

jest.mock('./api');
jest.mock('../household/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ session: { user: { id: 'me' } } }),
}));
jest.mock('../household/HouseholdProvider', () => ({
  useHousehold: () => ({ household: { id: 'household-1' } }),
}));

function renderSheet(onDismiss = jest.fn()) {
  return render(
    <ToastProvider>
      <StartRoundSheet visible onDismiss={onDismiss} />
    </ToastProvider>,
  );
}

const mockedApi = api as jest.Mocked<typeof api>;
const mockedHouseholdApi = householdApi as jest.Mocked<typeof householdApi>;
const mockedUseRouter = useRouter as jest.Mock;
const push = jest.fn();

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push });
});

it('defaults the target-count stepper to 4', async () => {
  await renderSheet();
  expect(screen.getByText('4')).toBeTruthy();
});

it('increments and decrements the target count, clamped to [1, 10]', async () => {
  await renderSheet();

  const decrement = screen.getByTestId('start-round-target-decrement');
  const increment = screen.getByTestId('start-round-target-increment');

  for (let i = 0; i < 10; i++) await fireEvent.press(decrement);
  expect(screen.getByText('1')).toBeTruthy();

  for (let i = 0; i < 20; i++) await fireEvent.press(increment);
  expect(screen.getByText('10')).toBeTruthy();
});

it('calls startSelectionRound with the current target count and navigates to the deck on success', async () => {
  mockedApi.startSelectionRound.mockResolvedValue({ roundId: 'round-1', candidateCount: 12 });
  const onDismiss = jest.fn();

  await renderSheet(onDismiss);
  await fireEvent.press(screen.getByTestId('start-round-target-increment'));
  await fireEvent.press(screen.getByTestId('start-round-solo'));

  await waitFor(() =>
    expect(mockedApi.startSelectionRound).toHaveBeenCalledWith({
      mode: 'solo',
      targetCount: 5,
      mealsOnly: false,
    }),
  );
  expect(onDismiss).toHaveBeenCalled();
  expect(push).toHaveBeenCalledWith('/smart-selection/round-1');
});

it('surfaces the thrown error message and leaves the sheet open on a conflict', async () => {
  mockedApi.startSelectionRound.mockRejectedValue(
    new Error('a selection round is already in progress for this household'),
  );
  const onDismiss = jest.fn();

  await renderSheet(onDismiss);
  await fireEvent.press(screen.getByTestId('start-round-solo'));

  await waitFor(() =>
    expect(
      screen.getByText('a selection round is already in progress for this household'),
    ).toBeTruthy(),
  );
  expect(onDismiss).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

it('uses the remembered planning preference when starting a round', async () => {
  await AsyncStorage.setItem('keepsake.planning.mealsOnly', 'true');
  mockedApi.startSelectionRound.mockResolvedValue({ roundId: 'meals-round', candidateCount: 3 });
  await renderSheet();
  await waitFor(() =>
    expect(screen.getByTestId('start-round-meals-only')).toHaveProp('accessibilityState', {
      selected: true,
    }),
  );
  await fireEvent.press(screen.getByTestId('start-round-solo'));
  expect(mockedApi.startSelectionRound).toHaveBeenCalledWith({
    mode: 'solo',
    targetCount: 4,
    mealsOnly: true,
  });
});

describe('Pick together', () => {
  const household = [
    { userId: 'me', displayName: 'Kraig' },
    { userId: 'user-blair', displayName: 'Blair' },
    { userId: 'user-alex', displayName: 'Alex' },
  ];

  beforeEach(() => {
    FLAGS.groupMealSelection = true;
    mockedHouseholdApi.fetchHouseholdMembers.mockResolvedValue(household);
  });

  afterEach(() => {
    FLAGS.groupMealSelection = false;
  });

  async function openTogether() {
    await renderSheet();
    await waitFor(() => expect(screen.getByTestId('start-round-together')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('start-round-together'));
  }

  it('is hidden while the flag is off', async () => {
    FLAGS.groupMealSelection = false;
    await renderSheet();
    expect(screen.queryByTestId('start-round-together')).toBeNull();
    expect(mockedHouseholdApi.fetchHouseholdMembers).not.toHaveBeenCalled();
  });

  it('is disabled in a one-person household and points at the invite flow', async () => {
    mockedHouseholdApi.fetchHouseholdMembers.mockResolvedValue([household[0]!]);
    const onDismiss = jest.fn();
    await renderSheet(onDismiss);

    await waitFor(() => expect(screen.getByText(/Invite someone to your household/)).toBeTruthy());
    expect(screen.getByTestId('start-round-together')).toBeDisabled();

    await fireEvent.press(screen.getByText(/Invite someone to your household/));
    expect(onDismiss).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/settings');
  });

  it('lists you, locked in, then everyone else alphabetically, all ticked', async () => {
    await openTogether();

    const self = screen.getByTestId('start-round-member-self');
    expect(self).toHaveProp('accessibilityState', { checked: true, disabled: true });
    expect(screen.getByTestId('start-round-member-user-alex')).toHaveProp('accessibilityState', {
      checked: true,
      disabled: false,
    });
    const names = screen
      .getAllByRole('checkbox')
      .map((row) => (row.props as { accessibilityLabel: string }).accessibilityLabel);
    expect(names).toEqual(['You', 'Alex', 'Blair']);
    expect(screen.getByText('Start round with 3')).toBeTruthy();
  });

  it('counts only who is ticked, and needs at least one other person', async () => {
    await openTogether();

    await fireEvent.press(screen.getByTestId('start-round-member-user-blair'));
    expect(screen.getByText('Start round with 2')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('start-round-member-user-alex'));
    expect(screen.getByText('Start round with 1')).toBeTruthy();
    expect(screen.getByText('Pick at least one other person.')).toBeTruthy();
    expect(screen.getByTestId('start-round-together-start')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('start-round-member-self'));
    expect(screen.getByText('Start round with 1')).toBeTruthy();
  });

  it('starts a group round with the ticked members and the chosen deadline', async () => {
    mockedApi.startSelectionRound.mockResolvedValue({ roundId: 'round-9', candidateCount: 12 });
    await openTogether();

    await fireEvent.press(screen.getByTestId('start-round-member-user-blair'));
    await fireEvent.press(screen.getByTestId('start-round-deadline-in-2-days'));
    await fireEvent.press(screen.getByTestId('start-round-together-start'));

    const now = new Date();
    const expectedClose = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 20);
    await waitFor(() =>
      expect(mockedApi.startSelectionRound).toHaveBeenCalledWith({
        mode: 'group',
        participantUserIds: ['user-alex'],
        targetCount: 4,
        mealsOnly: false,
        closesAt: expectedClose.toISOString(),
      }),
    );
    expect(push).toHaveBeenCalledWith('/smart-selection/round-9');
  });

  it('defaults the deadline to tomorrow at 8 PM', async () => {
    await openTogether();
    expect(screen.getByTestId('start-round-deadline-tomorrow')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('goes back to the first step, and reopens there after closing', async () => {
    const view = await renderSheet();
    await waitFor(() => expect(screen.getByTestId('start-round-together')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('start-round-together'));
    await fireEvent.press(screen.getByTestId('start-round-together-back'));
    expect(screen.getByTestId('start-round-solo')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('start-round-together'));
    await fireEvent.press(screen.getByTestId('start-round-invite'));
    view.rerender(
      <ToastProvider>
        <StartRoundSheet visible onDismiss={jest.fn()} />
      </ToastProvider>,
    );
    expect(screen.getByTestId('start-round-solo')).toBeTruthy();
  });

  it('scrolls a large household while keeping the start button reachable', async () => {
    const big = Array.from({ length: 12 }, (_, i) => ({
      userId: `user-${i}`,
      displayName: `Member ${String(i).padStart(2, '0')}`,
    }));
    mockedHouseholdApi.fetchHouseholdMembers.mockResolvedValue([household[0]!, ...big]);
    await openTogether();

    const scroll = screen.getByTestId('start-round-together-scroll');
    expect(within(scroll).getByTestId('start-round-member-user-11')).toBeTruthy();
    expect(within(scroll).queryByTestId('start-round-together-start')).toBeNull();
    expect(screen.getByTestId('start-round-together-start')).toBeTruthy();
    expect(screen.getByText('Start round with 13')).toBeTruthy();
  });

  it('forgets the roster on close, so a reopened sheet waits for a fresh one', async () => {
    const onDismiss = jest.fn();
    const view = await render(
      <ToastProvider>
        <StartRoundSheet visible onDismiss={onDismiss} />
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('start-round-together')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('start-round-together'));
    await fireEvent.press(screen.getByTestId('start-round-invite'));
    expect(onDismiss).toHaveBeenCalled();

    let resolveRefetch: (members: typeof household) => void = () => {};
    mockedHouseholdApi.fetchHouseholdMembers.mockReturnValue(
      new Promise((resolve) => (resolveRefetch = resolve)),
    );
    await view.rerender(
      <ToastProvider>
        <StartRoundSheet visible={false} onDismiss={onDismiss} />
      </ToastProvider>,
    );
    await view.rerender(
      <ToastProvider>
        <StartRoundSheet visible onDismiss={onDismiss} />
      </ToastProvider>,
    );

    expect(screen.getByTestId('start-round-together')).toBeDisabled();
    await act(async () => resolveRefetch([household[0]!, household[1]!]));
    await waitFor(() => expect(screen.getByTestId('start-round-together')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('start-round-together'));
    expect(screen.getByText('Start round with 2')).toBeTruthy();
  });

  it('offers a retry when the household cannot be loaded', async () => {
    mockedHouseholdApi.fetchHouseholdMembers.mockRejectedValueOnce(new Error('offline'));
    await renderSheet();

    await waitFor(() => expect(screen.getByTestId('start-round-members-retry')).toBeTruthy());
    expect(screen.getByTestId('start-round-together')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('start-round-members-retry'));
    await waitFor(() => expect(screen.getByTestId('start-round-together')).not.toBeDisabled());
    expect(mockedHouseholdApi.fetchHouseholdMembers).toHaveBeenCalledTimes(2);
  });
});
