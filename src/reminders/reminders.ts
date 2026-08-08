import * as Linking from 'expo-linking';
import * as Calendar from 'expo-calendar/legacy';

/**
 * Phase 1 risk-spike proof for GRO-03 (Apple Reminders — the only MVP
 * grocery export target), now the real Phase 14 feature (ADR-0023).
 * Only Reminders permission is requested (app.json sets
 * calendarPermission: false) — minimal native permissions per
 * execution-plan.md §2.6.
 *
 * Imports from 'expo-calendar/legacy': SDK 57's default export moved to a
 * new object-oriented API (ExpoCalendar class, requestRemindersPermissions
 * without the Async suffix, etc). The legacy named-function API used here
 * still ships and is Expo's own documented migration path, but a future
 * phase should re-evaluate against the new API before it's removed.
 */
const GROCERY_LIST_TITLE = 'Keepsake Groceries';

// Opens the real Reminders app — the exact URL the Phase 1 risk spike
// verified opens it (docs/risk-spikes/reminders.md), used by Phase 14's
// export result panel. Reminders has no public URL scheme to jump to a
// specific list, only the app itself.
const REMINDERS_APP_URL = 'x-apple-reminderkit://';

/**
 * Returns the full permission response, not just `granted` — Phase 14's
 * permission-recovery UI needs `canAskAgain` (false once iOS has denied
 * once; there's no re-prompting, only Settings) to decide whether to
 * offer another in-app request or point the user at Settings instead.
 */
export async function requestReminderPermission(): Promise<Calendar.PermissionResponse> {
  return Calendar.requestRemindersPermissionsAsync();
}

export function openReminders(): Promise<true> {
  return Linking.openURL(REMINDERS_APP_URL);
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
