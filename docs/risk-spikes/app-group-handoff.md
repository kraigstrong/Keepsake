# Risk Spike: App Group Handoff

**Phase 1.** Proves the App Group entitlement actually resolves a shared container the main app can read and write, before Phase 9 builds the real Safari Share Extension on top — the extension will write an imported URL there, and the main app will read it. This spike proves the plumbing; task #20 (Safari Share Extension risk spike) adds the actual extension target.

## Question

Does the App Group entitlement (`com.apple.security.application-groups`) actually resolve a real, working shared container — not just compile into the app — and can the main app reliably read/write a file there?

## Setup

- Chose the App Group identifier `group.com.kraigstrong.keepsake`, matching the app's bundle ID convention.
- Added `ios.appleTeamId` (developer's Apple Developer Team ID) and `ios.entitlements` to `app.json`. Expo's prebuild merges `ios.entitlements` directly into the generated `.entitlements` file and `ios.appleTeamId` into the Xcode project's `DEVELOPMENT_TEAM` build setting — no custom config plugin needed for this part.
- Scaffolded a small local Expo Module (`modules/app-group-bridge`) rather than adding a third-party dependency for this one narrow need. It exposes `containerAvailable()`, `writeTestPayload(value)`, and `readTestPayload()`, backed by `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)` — a file in the shared container, not shared `UserDefaults`, matching the payload-file handoff design the real Share Extension will use (see execution-plan.md's "Share payload contracts" test category).

## Findings

**Rebuild confirmed the entitlement compiled correctly:** after `expo prebuild --platform ios`, `ios/Keepsake/Keepsake.entitlements` contains the App Group array, and the Xcode project's `DEVELOPMENT_TEAM` build setting is set to the provided Team ID. The local module pod (`AppGroupBridge`) linked cleanly via CocoaPods with no signing prompts — App Group entitlements resolve on Simulator without needing Xcode signed into an Apple ID or a real provisioning profile, since Simulator doesn't enforce code-signing/entitlement verification against Apple's servers the way a physical device does.

**Verified on Simulator, end-to-end, at two levels:**
1. In-app: tapped "Write + read App Group payload" → wrote a timestamped string, read it back through the native bridge, and the app reported `round-tripped (keepsake-app-group-test <timestamp>)` — proving the container resolves and a same-session write/read round-trips correctly.
2. Filesystem: independently located and read the actual file at `.../data/Containers/Shared/AppGroup/<container-id>/share-inbox-test.json` on the host machine, containing exactly the value the app wrote — confirming this is a genuine App Group container, not an app-sandbox fallback path silently standing in for a broken group ID.

## Automated evidence

`src/appGroup/appGroupHandoff.test.ts` — 3 tests against the JS wrapper with the native bridge mocked (round-trip, null-when-empty, container-unavailable reflection).

## Security note (execution-plan.md §2.6, "No long-lived service credential in App Group storage")

This spike's payload is a disposable test string with no credential material. The real Share Extension design (Phase 9) must keep that constraint: only a URL/import-job description goes in the shared container, never an auth token — the extension itself must stay unable to authenticate on its own, matching "no privileged credential in app or extension bundle."

## Not yet done

- Cross-process proof: this spike only proves the *main app* can read/write the container. Proving a second process (the actual Share Extension target) can write and the main app can read what it wrote is task #20's job, not this one.
- Physical-device confirmation — App Group container resolution on a real device also needs a valid provisioning profile with the App Group capability enabled in the Apple Developer portal, which requires the developer's Apple ID signed into Xcode. That's an account-level action reserved for the developer, per ADR-0003's physical-device requirement for this phase.

## Conclusion

The entitlement and shared-container mechanism are proven end-to-end on Simulator, at both the app-behavior level and the filesystem level. What's left — a second process actually writing to it, and physical-device signing — is explicitly scoped to task #20 and the developer's device pass.
