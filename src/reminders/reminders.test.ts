import * as Calendar from 'expo-calendar/legacy';

import { addGroceryReminder, getOrCreateGroceryList, requestReminderPermission } from './reminders';

jest.mock('expo-calendar/legacy', () => ({
  requestRemindersPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  createCalendarAsync: jest.fn(),
  createReminderAsync: jest.fn(),
  EntityTypes: { REMINDER: 'reminder' },
}));

const mocked = Calendar as jest.Mocked<typeof Calendar>;

describe('requestReminderPermission', () => {
  it('reflects the permission response', async () => {
    mocked.requestRemindersPermissionsAsync.mockResolvedValue({ granted: true } as never);
    expect(await requestReminderPermission()).toBe(true);
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
