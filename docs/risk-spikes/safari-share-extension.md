# Risk Spike: Safari Share Extension

**Phase 1.** Proves a real iOS Share Extension can capture a URL from Safari's native Share Sheet and hand it to the main app via the App Group container ([app-group-handoff.md](app-group-handoff.md)), before Phase 9 builds authenticated submission, offline staging, and retry on top. Matches the PRD's "Safari Share Sheet" import source (prd.md §8).

## What this is for

The PRD lists Safari Share Sheet as a supported import source: browsing a recipe in Safari, tapping Share, and picking Keepsake sends the page URL into Keepsake's normal import pipeline (fetch → reduce to text → AI parse → save), without manual copy/paste.

## The tooling problem and decision

`expo prebuild` regenerates the `ios/` directory from scratch on every run (Continuous Native Generation) — a Share Extension is a second Xcode target, and hand-adding one directly in Xcode would be silently wiped out on the next prebuild. This needs a config plugin that (re)generates the target every time.

Evaluated three options with the developer: accept `@bacons/apple-targets` (the standard tool for this, maintained by an Expo core team member) despite its dependency footprint; hand-roll a config plugin against `@expo/config-plugins` directly; or scope Phase 1 down to a manual, non-survives-prebuild proof and defer tooling choice to Phase 9. Decided on the first option, with one real cost to manage: `@bacons/apple-targets` pulls its own nested copy of the Expo CLI toolchain (`@bacons/xcode` → `@expo/plist` → `@xmldom/xmldom`), which carries known high-severity findings (XML injection / DoS in `@xmldom/xmldom`, no fix currently available) that would otherwise fail the CI dependency-scan gate.

Resolved without weakening the gate for the app itself: `@bacons/apple-targets` only runs during `expo prebuild` — none of its code ships in the app or server bundle — so it's a `devDependency`, and CI's dependency-scan step now runs `npm audit --omit=dev --audit-level=high` instead of a blanket `--audit-level=high`. This scopes the exception to build-tooling only, documented inline in `.github/workflows/ci.yml`, `docs/threat-model.md` (T8), and `docs/release-checklist.md` — not silently widened. `npm audit --omit=dev --audit-level=high` exits 0.

## Findings

**Target scaffolded via `npx create-target share`, then customized:**
- `targets/share/expo-target.config.js` — `type: "share"`, mirrors the main app's App Group entitlement from `app.json` rather than hardcoding a second copy.
- `targets/share/Info.plist` — replaced the generated `TRUEPREDICATE` (matches literally anything shared from any app) with `NSExtensionActivationSupportsWebURLWithMaxCount: 1` + `NSExtensionActivationSupportsWebPageWithMaxCount: 1` — the standard Apple-documented rule for "only offer this extension when sharing exactly one web URL," matching the PRD's actual scope instead of over-broadly appearing for every share type.
- `targets/share/ShareViewController.swift` — replaced the generated `SLComposeServiceViewController` boilerplate (a text-composer UI with a "Post" button) with a small custom `UIViewController`. The PRD's import flow has no mandatory review step, so a compose-and-post interaction would be the wrong shape entirely — this extension captures the URL, writes it to the shared container, shows "Saved to Keepsake," and auto-dismisses after 0.6s, matching a Pocket/Instapaper-style "send and go" extension rather than a composer.

**Extended the App Group bridge** (`modules/app-group-bridge`) with `readSharePayload()`/`clearSharePayload()`, reading a distinct file (`share-inbox.json`) from the one the App Group round-trip spike uses (`share-inbox-test.json`) — keeps "did our own app's round-trip work" and "did the real extension hand off real data" as two separately falsifiable checks, not conflated. `src/appGroup/appGroupHandoff.ts`'s `readSharedImport()` parses the JSON defensively (checks shape, not just `JSON.parse` success) and returns `null` rather than throwing on anything malformed — this file is written by our own extension, not arbitrary external input, but a partial write mid-extraction should degrade to "nothing to import," not crash app startup.

**Verified end-to-end on Simulator, for real, not simulated:**
1. Opened Safari, navigated to a real page, tapped Share — "Keepsake" appeared in the native Share Sheet's app row (proof the `NSExtensionActivationRule` correctly matches a shared web URL and the extension target registered with the OS).
2. Tapped Keepsake — the extension activated, and independent filesystem inspection (`.../Containers/Shared/AppGroup/<id>/share-inbox.json`) confirmed it wrote `{"url":"https://example.com/","receivedAt":1785685999129}` — the real shared URL, not a placeholder.
3. Share Sheet dismissed cleanly with no crash.
4. Relaunched the main Keepsake app (`xcrun simctl launch`, simulating a cold-launch-after-share) — the app read the same payload on mount and displayed `Share Extension spike: received https://example.com/ (at 1785685999129)`, matching the file on disk exactly.

**Verified end-to-end on a physical device (developer, 2026-08-02):** real Safari Share Sheet on-device, "Keepsake" appeared and captured the URL, main app read it back correctly on reopen. Confirms the App Group container resolves correctly with a real provisioning profile, not just Simulator's unenforced version.

**Real UX finding from the physical-device pass, not visible from Simulator taps:** the extension's "Saved to Keepsake" confirmation state is too brief (0.6s) to register — from the developer's own words, "it just disappeared. No confirmation, but the data was sent, which is the important part." The mechanism works; the felt experience doesn't yet match the PRD's "calm" ethos — a share action that appears to do nothing undermines confidence even when it worked. This is a UX-polish item, not a mechanism failure, so it's scoped to Phase 9 ("Final Share Extension") rather than fixed in this spike — but flagged explicitly here so Phase 9 doesn't rediscover it from scratch. Candidate fixes for Phase 9 to evaluate: a longer/more legible confirmation state, a success icon instead of just text, or haptic feedback on capture.

## Security note (execution-plan.md §2.6, "No privileged credentials in extension")

The extension writes only a URL and a timestamp to the shared container — no auth token, no session data. It cannot authenticate on its own; the main app owns all credentialed calls. This constraint must hold through Phase 9's real implementation, not just this spike.

## Not yet done

- Authenticated submission, offline staging when signed out, retry, and bulk URL import — all explicitly Phase 9 scope ("Final Share Extension"), not this spike's job.
- Share Extension confirmation-state UX (see finding above) — Phase 9.
- Re-run `npm audit` without `--omit=dev` periodically to check whether `@bacons/apple-targets` picks up a fix for the `@xmldom/xmldom` findings upstream.

## Conclusion

The full mechanism — Safari Share Sheet → real Xcode extension target → App Group container → main app read — is proven end-to-end on both Simulator and a physical device, with a real URL, not a mock. The one open architectural decision (accepting a devDependency with unresolved high-severity build-tooling findings) was made explicitly with the developer, scoped narrowly via `--omit=dev`, and documented in three places rather than silently absorbed into the existing dependency-scan exception. The physical-device pass surfaced one real UX gap (confirmation state too brief to register) — captured for Phase 9, not silently dropped.
