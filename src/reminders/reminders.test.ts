import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as Calendar from 'expo-calendar/legacy';

import {
  addGroceryReminder,
  getActiveReminderIds,
  getOrCreateGroceryList,
  getOwnedGroceryListId,
  openReminders,
  requestReminderPermission,
} from './reminders';

jest.mock('expo-calendar/legacy', () => ({
  requestRemindersPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  createCalendarAsync: jest.fn(),
  createReminderAsync: jest.fn(),
  getRemindersAsync: jest.fn(),
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

describe('getOwnedGroceryListId', () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('reuses a remembered list id without re-searching by title', async () => {
    await AsyncStorage.setItem('keepsake.reminders.groceryListId', 'owned-id');
    mocked.getCalendarsAsync.mockResolvedValue([
      { id: 'owned-id', title: 'Keepsake Groceries', source: { id: 'src-1' } },
    ] as never);

    const id = await getOwnedGroceryListId();

    expect(id).toBe('owned-id');
    expect(mocked.createCalendarAsync).not.toHaveBeenCalled();
  });

  it('falls back to title search and remembers the result when the remembered list is gone', async () => {
    await AsyncStorage.setItem('keepsake.reminders.groceryListId', 'deleted-id');
    mocked.getCalendarsAsync.mockResolvedValue([
      { id: 'other-id', title: 'Some Other List', source: { id: 'src-1' } },
    ] as never);
    mocked.createCalendarAsync.mockResolvedValue('new-id' as never);

    const id = await getOwnedGroceryListId();

    expect(id).toBe('new-id');
    expect(await AsyncStorage.getItem('keepsake.reminders.groceryListId')).toBe('new-id');
  });

  it('creates and remembers a list on the very first export', async () => {
    mocked.getCalendarsAsync.mockResolvedValue([
      { id: 'other-id', title: 'Some Other List', source: { id: 'src-1' } },
    ] as never);
    mocked.createCalendarAsync.mockResolvedValue('new-id' as never);

    const id = await getOwnedGroceryListId();

    expect(id).toBe('new-id');
    expect(await AsyncStorage.getItem('keepsake.reminders.groceryListId')).toBe('new-id');
  });

  it('prefers a native "Groceries" list over the remembered owned list', async () => {
    await AsyncStorage.setItem('keepsake.reminders.groceryListId', 'owned-id');
    mocked.getCalendarsAsync.mockResolvedValue([
      { id: 'owned-id', title: 'Keepsake Groceries', source: { id: 'src-1' } },
      { id: 'native-id', title: 'Groceries', source: { id: 'src-1' } },
    ] as never);

    const id = await getOwnedGroceryListId();

    expect(id).toBe('native-id');
    expect(mocked.createCalendarAsync).not.toHaveBeenCalled();
  });

  it('prefers a native "Groceries" list over creating one on first export', async () => {
    mocked.getCalendarsAsync.mockResolvedValue([
      { id: 'native-id', title: 'Groceries', source: { id: 'src-1' } },
    ] as never);

    const id = await getOwnedGroceryListId();

    expect(id).toBe('native-id');
    expect(mocked.createCalendarAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('keepsake.reminders.groceryListId')).toBeNull();
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

describe('getActiveReminderIds', () => {
  it('includes incomplete reminders and excludes completed ones', async () => {
    mocked.getRemindersAsync.mockResolvedValue([
      { id: 'r1', completed: false },
      { id: 'r2', completed: true },
      { id: 'r3' },
    ] as never);

    const ids = await getActiveReminderIds('list-1');

    expect(ids).toEqual(new Set(['r1', 'r3']));
    expect(mocked.getRemindersAsync).toHaveBeenCalledWith(['list-1'], null, null, null);
  });

  it('naturally excludes a reminder deleted since it was last recorded', async () => {
    // A deleted reminder just never shows up in getRemindersAsync — no
    // separate "not found" case to handle.
    mocked.getRemindersAsync.mockResolvedValue([{ id: 'still-here', completed: false }] as never);

    const ids = await getActiveReminderIds('list-1');

    expect(ids.has('deleted-reminder-id')).toBe(false);
  });
});
