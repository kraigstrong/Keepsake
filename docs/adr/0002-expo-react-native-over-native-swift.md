# ADR-0002: Use Expo/React Native, not native Swift, for the iOS client

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 0

## Context

Pantry is iOS-only for MVP. The two realistic client choices were a managed/Expo React Native app or a native Swift/SwiftUI app. The developer has existing Expo/React Native experience and wants a cheap way to validate simple flows in a browser during development.

Two capabilities in the plan are native-only and don't have a pure-JS path: the Safari Share Extension (Phase 9) and Apple Reminders export (Phase 14). A few others behave differently or not at all in Simulator: live camera capture (Phase 10) and screen-awake/real kitchen use (Phase 15).

## Decision

Build the client in Expo + React Native + TypeScript, using Expo's prebuild / custom-development-client workflow (not Expo Go) once native modules are needed — which is essentially immediately, since Share Extension and Reminders both require it. Expo web is used as an internal development aid only, not a shipping target.

## Alternatives considered

- **Native Swift/SwiftUI:** would give the most direct access to Share Extensions, EventKit (Reminders), and camera APIs with no config-plugin layer in between. Rejected because the developer doesn't have deep existing Swift experience, the app has no cross-cutting need for Swift-only APIs beyond the four items above, and Expo's prebuild path can reach all of them — it just needs proving early, which is exactly what Phase 1's risk spikes are for.
- **Expo managed workflow (Expo Go) only, no prebuild:** rejected outright — Expo Go cannot host a Share Extension or App Group, so it can't reach MVP scope at all.

## Consequences

- Phase 1's risk spikes (Safari Share Extension, Apple Reminders, camera, keep-awake) are load-bearing: if any of them turn out to be materially harder under Expo's prebuild path than expected, that's the point at which reconsidering native modules (or a native Swift Share Extension target alongside an Expo-managed main app — a common hybrid pattern) becomes a live option. Re-open this ADR if that happens.
- CI and local dev need Expo's prebuild output (the generated `ios/` directory) to exist for native builds — this affects what Phase 0's build verification actually builds.
- The web build's non-native flows (Library, Search, recipe editing, planning) are useful for fast iteration, but Camera, Share Extension, Reminders export, and keep-awake will not work on web and shouldn't be tested there.
