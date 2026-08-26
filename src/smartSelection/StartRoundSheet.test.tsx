import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import { StartRoundSheet } from './StartRoundSheet';
import { ToastProvider } from '../components/Toast';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

function renderSheet(onDismiss = jest.fn()) {
  return render(
    <ToastProvider>
      <StartRoundSheet visible onDismiss={onDismiss} />
    </ToastProvider>,
  );
}

const mockedApi = api as jest.Mocked<typeof api>;
const mockedUseRouter = useRouter as jest.Mock;
const push = jest.fn();

beforeEach(() => {
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
    expect(mockedApi.startSelectionRound).toHaveBeenCalledWith({ mode: 'solo', targetCount: 5 }),
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
