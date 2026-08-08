import * as Linking from 'expo-linking';
import * as Calendar from 'expo-calendar/legacy';

import {
  addGroceryReminder,
  getOrCreateGroceryList,
  openReminders,
  requestReminderPermission,
} from './reminders';

jest.mock('expo-calendar/legacy', () => ({
  requestRemindersPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  createCalendarAsync: jest.fn(),
  createReminderAsync: jest.fn(),
  EntityTypes: { REMINDER: 'reminder' },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const mocked = Calendar as jest.Mocked<typeof Calendar>;
const mockedLinking = Linking as jest.Mocked<typeof Linking>;

describe('requestReminderPermission', () => {
  it('returns the full permission response, including canAskAgain', async () => {
    mocked.requestRemindersPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      status: 'denied',
      expires: 'never',
    } as never);

    expect(await requestReminderPermission()).toEqual({
      granted: false,
      canAskAgain: false,
      status: 'denied',
      expires: 'never',
    });
  });
});

describe('openReminders', () => {
  it('opens the Reminders app via its URL scheme', async () => {
    await openReminders();
    expect(mockedLinking.openURL).toHaveBeenCalledWith('x-apple-reminderkit://');
  });
});

describe('getOrCreateGroceryList', () => {
  afterEach(() => jest.clearAllMocks());

  it('reuses an existing "Keepsake Groceries" list without creating a new one', async () => {
    mocked.getCalendarsAsync.mockResolvedValue([
      { id: 'existing-id', title: 'Keepsake Groceries', source: { id: 'src-1' } },
    ] as never);

    const id = await getOrCreateGroceryList();

    expect(id).toBe('existing-id');
    expect(mocked.createCalendarAsync).not.toHaveBeenCalled();
  });

  it('creates a list using an existing reminder source when none exists yet', async () => {
    mocked.getCalendarsAsync.mockResolvedValue([
      { id: 'other-list', title: 'Some Other List', source: { id: 'src-1' } },
    ] as never);
    mocked.createCalendarAsync.mockResolvedValue('new-id' as never);

    const id = await getOrCreateGroceryList();

    expect(id).toBe('new-id');
    expect(mocked.createCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Keepsake Groceries', sourceId: 'src-1' }),
    );
  });

  it('throws a clear error when there is no reminder source to create from', async () => {
    mocked.getCalendarsAsync.mockResolvedValue([] as never);

    await expect(getOrCreateGroceryList()).rejects.toThrow('No reminder source available');
  });
});

describe('addGroceryReminder', () => {
  it('creates a reminder with the given title in the given list', async () => {
    mocked.createReminderAsync.mockResolvedValue('reminder-id' as never);

    const id = await addGroceryReminder('list-1', 'Milk');

    expect(id).toBe('reminder-id');
    expect(mocked.createReminderAsync).toHaveBeenCalledWith('list-1', { title: 'Milk' });
  });
});
