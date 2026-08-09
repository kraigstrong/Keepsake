import AsyncStorage from '@react-native-async-storage/async-storage';
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

// The title iOS's own "Groceries" list template uses (Reminders' New
// List -> list type picker) — that list type auto-sorts items into
// aisle sections as they're typed. EventKit exposes no way to create
// that type or detect it as anything but an ordinary list, only match
// by title (developer experiment, 2026-08-08: does an item added via
// createReminderAsync still land sorted?). Harmless if this happens to
// match an unrelated ordinary list of the same name — it's still a
// reasonable place to put groceries, just without the auto-sort.
const NATIVE_GROCERIES_LIST_TITLE = 'Groceries';

// Remembers the EventKit id of the list this app itself created, so a
// later export can verify ownership instead of matching on title alone
// — a title match can't distinguish this app's own list from an
// unrelated list a user (or another app) happens to have named the
// same thing (Codex review, PR #46). AsyncStorage, not local SQLite:
// a single scalar value, same pattern as sortPreference.ts.
const OWNED_LIST_ID_KEY = 'keepsake.reminders.groceryListId';

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
 * Finds a list by exact title match, otherwise creates one. iOS
 * EventKit requires a `sourceId` to create a new calendar/list — reused
 * from an existing reminder list's source rather than assumed, since
 * which source is "the local one" isn't guaranteed stable across
 * devices/iOS versions.
 *
 * Title-only matching is a real ownership gap on its own (a coincidentally
 * named unrelated list would be silently reused) — `getOwnedGroceryListId`
 * below is the real entry point production code should call; this stays
 * exported for that fallback path and for the Phase 1 risk spike's own
 * direct use.
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

/**
 * The real entry point for export (ADR-0023 amended, Codex review PR
 * #46): remembers the id of the list this app itself created and
 * revalidates it still exists before reusing it, rather than re-doing a
 * title-only search — and therefore a title-only *match* — on every
 * export. Falls back to `getOrCreateGroceryList()`'s title-based lookup
 * only when nothing is remembered yet (first ever export) or the
 * remembered list was deleted; that fallback still carries the original
 * title-match ambiguity, but only on that one-time/rare path rather than
 * on every export.
 *
 * Checks for a native "Groceries" list first (developer experiment,
 * 2026-08-08) — if the user already has one, prefer it over the
 * app-owned list every time, not just on first export, since they may
 * create or rename that list at any point after already having used
 * Keepsake's own list.
 */
export async function getOwnedGroceryListId(): Promise<string> {
  const lists = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);

  const native = lists.find((list) => list.title === NATIVE_GROCERIES_LIST_TITLE);
  if (native) {
    return native.id;
  }

  const rememberedId = await AsyncStorage.getItem(OWNED_LIST_ID_KEY).catch(() => null);
  if (rememberedId && lists.some((list) => list.id === rememberedId)) {
    return rememberedId;
  }

  const id = await getOrCreateGroceryList();
  await AsyncStorage.setItem(OWNED_LIST_ID_KEY, id).catch(() => {
    // Best-effort — losing this just means the next export re-verifies
    // by title again, not a correctness failure for this export itself.
  });
  return id;
}

export async function addGroceryReminder(listId: string, itemTitle: string): Promise<string> {
  return Calendar.createReminderAsync(listId, { title: itemTitle });
}

/**
 * IDs of reminders in `listId` that still exist and aren't checked off
 * (ADR-0023 amended, developer device-testing feedback 2026-08-08). A
 * `status: null` fetch with no date range returns every reminder in the
 * calendar regardless of completion — each carries its own `completed`
 * flag — so one call here answers both "was it deleted?" (absent from
 * the result) and "was it completed?" in a single native round trip
 * instead of one `getReminderAsync` per previously-exported item.
 */
export async function getActiveReminderIds(listId: string): Promise<ReadonlySet<string>> {
  const reminders = await Calendar.getRemindersAsync([listId], null, null, null);
  return new Set(
    reminders
      .filter((reminder) => !reminder.completed && reminder.id)
      .map((reminder) => reminder.id!),
  );
}
