# Invite Deep Link — Blank Screen for Every Real Invitee

**Result:** Merged | **Date:** 2026-09-01 | **PR:** [#139](https://github.com/kraigstrong/Keepsake/pull/139) — cross-cutting, not a numbered phase

The first real invitee tapped `keepsake:///invite/<token>` on 2026-08-31. The app opened and showed a blank screen. She gave up and signed up for her own account instead, reaching "Create a household" — the one irreversible action in the app (ADR-0004) — three seconds after saving her display name, because the blank screen had already pushed her onto the only path she could see.

## Cause

`app/invite/[token].tsx` (added in [#134](https://github.com/kraigstrong/Keepsake/pull/134)) captured the token, then did `<Redirect href="/" />`. `/` is `(tabs)`, which sits inside `AuthenticatedRouteBoundary`'s `<Stack.Protected guard={isOnboarded}>`.

Expo-router silently drops a **runtime** navigation to a screen whose guard is false. It only resolves against the available screens, and falls back, for the *initial* URL — which is why a plain cold launch to `/` correctly shows sign-in, and why nothing about this looked broken in ordinary use. So the replace did nothing, the invite route stayed the active screen, and `Redirect` renders `null`.

Reproduced before being fixed: `renderRouter('./app', { initialUrl: '/invite/<token>' })` with a null session rendered an empty `RNSScreen` titled `invite/[token]` containing only `<RNSScreenContentWrapper />`.

## Why it was signed off as verified

`docs/current.md` recorded build 3's invite route as "verified on a real device: the invite link opens the app instead of Unmatched Route". That test was real, and it passed — from an already-onboarded phone, which is the **one** state where `/` exists and the redirect lands. The two states a real invitee is in, signed out and signed in mid-onboarding, were both blank and neither was tried.

**The durable lesson: verify an invite flow from a device that has never joined a household, or you have verified nothing.** The same shape applies to any flow whose whole point is the state the developer's own device is never in.

## Fix

Branch to the route the invitee's current state can reach — sign-in, onboarding, or `(tabs)` — mirroring the boundary's three guards. Loading and load-error branches are deliberately absent: the boundary returns `StartupScreen`/`ErrorState` instead of the Stack, so the screen only renders once both have settled.

Three `renderRouter` suites, one per branch, one test per file (per `navigation.test.tsx`'s single-render constraint). `inviteRoute.needsHousehold.test.tsx` drives the real `DeepLinkProvider` rather than a mocked context, so it covers the whole path: deep link → token captured from the route param → onboarding → auto-accept, never offering "Create a household". Both broken branches were confirmed red before the fix.

## Staging cleanup and what it turned up

The invitee's account and her one-member household were removed from staging on 2026-09-01 (2 rows: one `household_membership`, one auto-created `weekly_plans`; no recipes, no Storage objects). Her account had been created 2026-08-31, and the invitation she never accepted stayed valid.

Two schema facts found while establishing the blast radius, both relevant to `docs/roadmap.md`'s open **account deletion** work item:

- **`import_jobs` and `import_batches` reference `households(id)` with no `on delete cascade`.** Every other household-scoped FK cascades; these two don't. Deleting any household that has ever run an import fails on a foreign-key violation.
- **Fifteen columns reference `auth.users` without cascade** — `invitations.accepted_by`, `recipes.created_by`/`archived_by`/`deleted_by`/`restored_by`, `recipe_versions.created_by`, `recipe_drafts.user_id`, `deleted_recipes.deleted_by`, `import_jobs.created_by`, `import_batches.created_by`, `planning_entries.added_by`, `grocery_item_selections.updated_by`, `cooking_events.cooked_by`, `selection_rounds.created_by`/`applied_by`. Any row in any of them blocks deleting that user.

Together these mean "delete a user and their household" is two deletes that can each fail for reasons the other doesn't cover, in an order where the second failing leaves the first already done. Real account deletion needs both handled, not just the cascades that happen to work.
