import * as Calendar from 'expo-calendar/legacy';

/**
 * Phase 1 risk-spike proof for GRO-03 (Apple Reminders — the only MVP
 * grocery export target) and Phase 14's real feature. Only Reminders
 * permission is requested (app.json sets calendarPermission: false) —
 * minimal native permissions per execution-plan.md §2.6.
 *
 * Imports from 'expo-calendar/legacy': SDK 57's default export moved to a
 * new object-oriented API (ExpoCalendar class, requestRemindersPermissions
 * without the Async suffix, etc). The legacy named-function API used here
 * still ships and is Expo's own documented migration path, but Phase 14
 * should re-evaluate against the new API before it's removed.
 */
const GROCERY_LIST_TITLE = 'Keepsake Groceries';

export async function requestReminderPermission(): Promise<boolean> {
  const { granted } = await Calendar.requestRemindersPermissionsAsync();
  return granted;
}

/**
 * Finds the app's own reminder list if it already exists, otherwise
 * creates it. iOS EventKit requires a `sourceId` to create a new
 * calendar/list — reused from an existing reminder list's source rather
 * than assumed, since which source is "the local one" isn't guaranteed
 * stable across devices/iOS versions.
 */
export async function getOrCreateGroceryList(): Promise<string> {
  const existingLists = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
  const existing = existingLists.find((list) => list.title === GROCERY_LIST_TITLE);
  if (existing) return existing.id;

  const sourceId = existingLists[0]?.source.id;
  if (!sourceId) {
    throw new Error(
      'No reminder source available to create a list from — device has no existing reminder lists.',
    );
  }

  return Calendar.createCalendarAsync({
    title: GROCERY_LIST_TITLE,
    color: '#34A853',
    entityType: Calendar.EntityTypes.REMINDER,
    sourceId,
  });
}

export async function addGroceryReminder(listId: string, itemTitle: string): Promise<string> {
  return Calendar.createReminderAsync(listId, { title: itemTitle });
}
