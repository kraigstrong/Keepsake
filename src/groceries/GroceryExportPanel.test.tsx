import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';

import { GroceryExportPanel } from './GroceryExportPanel';
import { getDatabase } from '../db/database';
import * as exportGroceriesModule from '../reminders/exportGroceries';
import * as remindersModule from '../reminders/reminders';
import { ToastProvider } from '../components/Toast';

jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));
jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../reminders/exportGroceries');
jest.mock('../reminders/reminders');

const mockedGetDatabase = getDatabase as jest.Mock;
const mockedExport = exportGroceriesModule.exportGroceriesToReminders as jest.Mock;
const mockedRequestPermission = remindersModule.requestReminderPermission as jest.Mock;
const mockedOpenReminders = remindersModule.openReminders as jest.Mock;
const mockedOpenSettings = Linking.openSettings as jest.Mock;

const ITEMS = [
  { itemHash: 'onion', displayText: '3 onions' },
  { itemHash: 'garlic', displayText: '1 head garlic' },
];

function renderPanel(items = ITEMS) {
  return render(
    <ToastProvider>
      <GroceryExportPanel planId="plan-1" householdId="household-1" items={items} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDatabase.mockResolvedValue({});
  mockedRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  mockedOpenReminders.mockResolvedValue(true);
});

it('disables the export button when there is nothing to export', async () => {
  await renderPanel([]);
  expect(screen.getByTestId('grocery-export-start').props.accessibilityState.disabled).toBe(true);
});

it('runs the export and shows a summary on success', async () => {
  mockedExport.mockResolvedValue({ succeeded: ['onion', 'garlic'], skipped: [], failed: [] });

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() => expect(screen.getByTestId('grocery-export-summary')).toBeTruthy());
  expect(screen.getByText('2 added')).toBeTruthy();
  expect(mockedExport).toHaveBeenCalledWith(
    {},
    { weeklyPlanId: 'plan-1', householdId: 'household-1', items: ITEMS },
    expect.any(Function),
  );
});

it('shows a mixed summary for skipped and failed items', async () => {
  mockedExport.mockResolvedValue({
    succeeded: ['onion'],
    skipped: ['garlic'],
    failed: [{ itemHash: 'x', message: 'boom' }],
  });

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() =>
    expect(screen.getByText('1 added, 1 already in Reminders, 1 failed')).toBeTruthy(),
  );
  expect(screen.getByTestId('grocery-export-retry-failed')).toBeTruthy();
});

it('offers a retry that re-runs the export', async () => {
  mockedExport.mockResolvedValueOnce({
    succeeded: [],
    skipped: [],
    failed: [{ itemHash: 'onion', message: 'boom' }],
  });

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));
  await waitFor(() => expect(screen.getByTestId('grocery-export-retry-failed')).toBeTruthy());

  mockedExport.mockResolvedValueOnce({ succeeded: ['onion'], skipped: [], failed: [] });
  await fireEvent.press(screen.getByTestId('grocery-export-retry-failed'));

  await waitFor(() => expect(screen.getByText('1 added')).toBeTruthy());
  expect(mockedExport).toHaveBeenCalledTimes(2);
});

it('opens Reminders when requested', async () => {
  mockedExport.mockResolvedValue({ succeeded: ['onion'], skipped: [], failed: [] });

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));
  await waitFor(() => expect(screen.getByTestId('grocery-export-open-reminders')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('grocery-export-open-reminders'));

  expect(mockedOpenReminders).toHaveBeenCalled();
});

it('shows a recoverable permission-denied state that lets the user try again', async () => {
  mockedRequestPermission.mockResolvedValue({ granted: false, canAskAgain: true });

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() => expect(screen.getByTestId('grocery-export-retry-permission')).toBeTruthy());
  expect(screen.queryByTestId('grocery-export-open-settings')).toBeNull();
});

it('shows an Open Settings state once iOS will no longer re-prompt', async () => {
  mockedRequestPermission.mockResolvedValue({ granted: false, canAskAgain: false });

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() => expect(screen.getByTestId('grocery-export-open-settings')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('grocery-export-open-settings'));

  expect(mockedOpenSettings).toHaveBeenCalled();
});

it('shows a toast and returns to idle if the export call itself throws', async () => {
  mockedExport.mockRejectedValue(new Error('boom'));

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() => expect(screen.getByTestId('grocery-export-start')).toBeTruthy());
});
