import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { AppState } from 'react-native';

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

// Same capture pattern as SessionProvider.test.tsx's AppState listener test.
const addEventListenerSpy = jest.spyOn(AppState, 'addEventListener');
let appStateHandler: (state: string) => void;

const ITEMS = [
  { itemHash: 'onion', displayText: '3 onions' },
  { itemHash: 'garlic', displayText: '1 head garlic' },
];

function outcome(overrides: Partial<exportGroceriesModule.GroceryExportOutcome> = {}) {
  return {
    succeeded: overrides.succeeded ?? [],
    skipped: overrides.skipped ?? [],
    partial: overrides.partial ?? [],
    failed: overrides.failed ?? [],
  };
}

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
  addEventListenerSpy.mockImplementation((_event, handler) => {
    appStateHandler = handler as (state: string) => void;
    return { remove: jest.fn() } as never;
  });
});

it('disables the export button when there is nothing to export', async () => {
  await renderPanel([]);
  expect(screen.getByTestId('grocery-export-start').props.accessibilityState.disabled).toBe(true);
});

it('runs the export and shows a summary on success', async () => {
  mockedExport.mockResolvedValue(outcome({ succeeded: ['onion', 'garlic'] }));

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

it('shows a mixed summary for skipped, partial, and failed items', async () => {
  mockedExport.mockResolvedValue(
    outcome({
      succeeded: ['some-hash'],
      skipped: ['another-hash'],
      partial: [{ itemHash: 'y', message: 'db locked' }],
      // Must match a real item in ITEMS — the retry button's visibility
      // is driven by matching failed hashes back against the items prop.
      failed: [{ itemHash: 'onion', message: 'boom' }],
    }),
  );

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() =>
    expect(
      screen.getByText('1 added, 1 already in Reminders, 1 added but not confirmed, 1 failed'),
    ).toBeTruthy(),
  );
  expect(screen.getByTestId('grocery-export-retry-failed')).toBeTruthy();
});

it('offers a retry that re-exports only the items that actually failed', async () => {
  mockedExport.mockResolvedValueOnce(outcome({ failed: [{ itemHash: 'onion', message: 'boom' }] }));

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));
  await waitFor(() => expect(screen.getByTestId('grocery-export-retry-failed')).toBeTruthy());

  mockedExport.mockResolvedValueOnce(outcome({ succeeded: ['onion'] }));
  await fireEvent.press(screen.getByTestId('grocery-export-retry-failed'));

  await waitFor(() => expect(screen.getByText('1 added')).toBeTruthy());
  expect(mockedExport).toHaveBeenCalledTimes(2);
  // Only the failed item — not garlic, which never failed — is retried.
  expect(mockedExport).toHaveBeenLastCalledWith(
    {},
    {
      weeklyPlanId: 'plan-1',
      householdId: 'household-1',
      items: [{ itemHash: 'onion', displayText: '3 onions' }],
    },
    expect.any(Function),
  );
});

it('never offers a retry action for partial items (they already exist in Reminders)', async () => {
  mockedExport.mockResolvedValue(
    outcome({ partial: [{ itemHash: 'onion', message: 'db locked' }] }),
  );

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() => expect(screen.getByTestId('grocery-export-summary')).toBeTruthy());
  expect(screen.queryByTestId('grocery-export-retry-failed')).toBeNull();
});

it('opens Reminders when requested', async () => {
  mockedExport.mockResolvedValue(outcome({ succeeded: ['onion'] }));

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

it('re-offers Export once the app returns to foreground after Open Settings', async () => {
  mockedRequestPermission.mockResolvedValue({ granted: false, canAskAgain: false });

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));
  await waitFor(() => expect(screen.getByTestId('grocery-export-open-settings')).toBeTruthy());

  appStateHandler('active');

  await waitFor(() => expect(screen.getByTestId('grocery-export-start')).toBeTruthy());
});

it('shows a toast and returns to idle if the export call itself throws', async () => {
  mockedExport.mockRejectedValue(new Error('boom'));

  await renderPanel();
  await fireEvent.press(screen.getByTestId('grocery-export-start'));

  await waitFor(() => expect(screen.getByTestId('grocery-export-start')).toBeTruthy());
});

it('ignores a second tap while permission is still being requested for the first', async () => {
  const { promise, resolve } = (() => {
    let res!: (value: { granted: boolean; canAskAgain: boolean }) => void;
    const p = new Promise<{ granted: boolean; canAskAgain: boolean }>((r) => (res = r));
    return { promise: p, resolve: res };
  })();
  mockedRequestPermission.mockReturnValue(promise);

  await renderPanel();
  fireEvent.press(screen.getByTestId('grocery-export-start'));
  fireEvent.press(screen.getByTestId('grocery-export-start'));

  resolve({ granted: true, canAskAgain: true });
  mockedExport.mockResolvedValue(outcome({ succeeded: ['onion', 'garlic'] }));

  await waitFor(() => expect(screen.getByTestId('grocery-export-summary')).toBeTruthy());
  expect(mockedRequestPermission).toHaveBeenCalledTimes(1);
});
