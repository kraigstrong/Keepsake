# Risk Spike: Apple Reminders (EventKit) Grocery Export

**Phase 1.** Proves `expo-calendar` can create and reuse a dedicated Reminders list and add items to it, before Phase 14 builds the real grocery-export feature on top. Matches GRO-03 (Apple Reminders is the only MVP grocery export target).

## Findings

**List reuse, not duplication (`src/reminders/reminders.ts`)** — `getOrCreateGroceryList()` looks for an existing "Keepsake Groceries" list before creating one, and when creating, reuses an existing reminder list's `sourceId` rather than assuming which EventKit source is "the local one" — that's not guaranteed stable across devices/iOS versions.

**Minimal permissions** — only Reminders access is requested; `app.json` sets `calendarPermission: false` explicitly, per execution-plan.md §2.6's minimal-native-permissions rule.

**Real bug found and fixed:** the installed `expo-calendar` version (57.0.1) moved its default export to a new object-oriented API and deprecated the legacy named-function API (`requestRemindersPermissionsAsync`, `getCalendarsAsync`, `createCalendarAsync`, `createReminderAsync`) this spike was written against — calling it threw `Method requestRemindersPermissionsAsync imported from "expo-calendar" is deprecated`, caught live on Simulator, not in a test. Fixed by importing from `expo-calendar/legacy` instead — Expo's own documented migration path, same function names and signatures, no logic changes needed. Phase 14 should re-evaluate against the new object-oriented API before the legacy path is eventually removed from the package.

**Verified on Simulator, end-to-end:** tapped "Add test grocery reminder" → real iOS permission dialog appeared showing our custom string *"Keepsake needs Reminders access to export your grocery list."* Granted access, app reported `reminder created`. Opened the real Reminders app (`xcrun simctl openurl booted "x-apple-reminderkit://"`) and confirmed a "Keepsake Groceries" list exists with 1 item — the list was genuinely created via EventKit, not just reported success by the app.

## Automated evidence

`src/reminders/reminders.test.ts` — 5 tests: permission reflection, list reuse, list creation (including the "no reminder source available" error case), and reminder creation. Native calls mocked.

## Physical-device confirmation

Confirmed by the developer on 2026-08-02.

## Conclusion

Chosen implementation path exists and is verified three ways — unit tests against the mocked API, a real end-to-end Simulator run that created a genuine EventKit list and item confirmed by inspecting the actual Reminders app, and a physical-device pass.
