# ADR-0007: Application-shell tooling — Expo Router structure, design tokens, session storage

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 2

## Context

Phase 2 build scope names Expo Router explicitly but leaves three things undecided, none of which the PRD answers directly: how the route tree is organized, how "design tokens" are actually implemented, and what backs "secure session storage." All three need an answer before any screen code can be written.

## Decision

**Navigation: Expo Router, with a route-group split matching the PRD's information architecture (prd.md §24).** `app/(tabs)/` holds the two permanent bottom tabs — This Week (`index.tsx`, the default screen per prd.md §15) and Library (`library.tsx`) — behind an authenticated route boundary. Settings is a pushed screen reachable from a header action, not a third tab, matching prd.md §24's explicit "Settings is secondary and does not require a permanent bottom tab." Recipe detail/edit/cooking-mode routes (Phase 4+) and the sign-in flow (Phase 3) will nest into this same tree later rather than requiring a restructure now.

**Design tokens: a plain TypeScript module (`src/theme/tokens.ts`), styled with React Native's built-in `StyleSheet`, not a styling framework.** Colors, spacing, typography scale, and radii as a plain exported object.

**Secure session storage: `expo-secure-store`.** Keychain-backed on iOS, which is what "secure" has to mean for a token that grants access to a household's private recipe data. This is the only credential-grade storage option in the Expo ecosystem for iOS — `AsyncStorage` is unencrypted and explicitly unsuitable for this. Phase 2 builds the storage + `SessionProvider`/`useSession()` shape against a stubbed session; Phase 3 replaces the stub with real Supabase Auth token handling without changing the boundary's shape.

## Alternatives considered

- **React Navigation directly, instead of Expo Router:** Expo Router is built on React Navigation and is what execution-plan.md's Phase 2 build scope already names — not a real alternative, just confirming there's no reason to drop to the lower-level API.
- **NativeWind / Tamagui / Restyle for design tokens:** rejected for the same reason `expo-camera` was dropped in Phase 1 — the PRD's actual scope (buttons, rows, chips, sheets, alerts, toasts; "few settings," "calm," deliberately not visually complex) doesn't need a styling framework's tooling. A framework earns its keep when a design system gets large or needs runtime theming beyond what a plain tokens object + `StyleSheet.create` handles; revisit only if that becomes true.
- **AsyncStorage (unencrypted) or plain in-memory session:** rejected outright — a household's recipe data is exactly the kind of thing SEC-03/SEC-04 (RLS, Storage membership checks) protect server-side, and none of that matters if the client-side session token protecting it sits in plaintext on disk.

## Consequences

- Later phases nesting into `app/(tabs)/` and the auth boundary don't need this ADR revisited unless the IA itself changes (a new permanent tab, for instance) — that would need a PRD change first, not just a code change.
- `expo-secure-store` requires no new credential or account — it's a local Keychain wrapper, nothing server-side, no 1Password involvement.
- The stubbed session shape Phase 2 builds is a real interface commitment: Phase 3 needs to satisfy it with actual Supabase Auth data (user id, household id, whatever `useSession()` exposes), not redesign it — worth Phase 3 re-reading this ADR before starting.

## Amendment (Phase 3, 2026-08-02)

Wiring real Supabase Auth (`supabase-js`) surfaced a real constraint this ADR didn't anticipate: a Supabase session (access + refresh JWT, user metadata) can exceed `expo-secure-store`'s ~2KB per-value Keychain limit. The fix (Supabase's own documented pattern for Expo) is `src/supabase/secureStore.ts`'s `LargeSecureStore`: the session itself lives in `@react-native-async-storage/async-storage`, AES-CTR encrypted with a key that lives in `expo-secure-store` (always 32 bytes, always under the limit). This isn't a reversal of "AsyncStorage is unencrypted and explicitly unsuitable" above — AsyncStorage here never holds plaintext, only ciphertext, so the property that made AsyncStorage unsuitable (readable by anything with filesystem access) doesn't apply to what's actually stored there.
