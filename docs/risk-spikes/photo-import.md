# Risk Spike: Camera and Photo Library Import

**Phase 1.** Proves both PRD-required photo-import sources (camera capture, existing photo) work through `expo-image-picker` with correct custom permission strings, before Phase 4/10 build the real import flow on top.

## Scope decision

Dropped `expo-camera` from the dependency set. `ImagePicker.launchCameraAsync()` covers both "take a photo" and "pick an existing photo" PRD import sources without needing a dedicated live-camera-view package — a separate camera package would only earn its keep if Keepsake needed a custom in-app camera UI (it doesn't; the OS camera sheet is enough for capturing a recipe card/page).

## Findings

**Permission-gated capture (`src/photoImport/photoImport.ts`)** — `captureFromCamera()` and `pickExistingPhoto()` each request their own permission first and return `null` (not throw) on denial or user cancellation, so callers can't accidentally treat "user said no" as an error.

**Verified on Simulator, end-to-end:** tapped "Pick existing photo" → real iOS permission dialog appeared showing our custom string *"Keepsake needs photo access to import a recipe photo."* — confirms `app.json`'s `expo-image-picker` plugin config (`photosPermission`/`cameraPermission`) reached the compiled Info.plist, not just the JS layer. Granted "Allow Full Access," the real photo-library picker sheet opened (6 stock Simulator photos), selected one, and the spike screen updated to `Photo spike: picked (4032x3024)` — confirming `toPickedPhoto()` correctly surfaces the asset's real dimensions.

Camera capture (`captureFromCamera()`) is unit-tested but not exercised on Simulator — the iOS Simulator has no real camera hardware, so `launchCameraAsync()` cannot be meaningfully verified until the physical-device pass.

## Automated evidence

`src/photoImport/photoImport.test.ts` — 5 tests (both functions × permission-denied/cancelled/success), native calls mocked.

## Physical-device confirmation

Photo-library picker confirmed by the developer on a real device (2026-08-02). `captureFromCamera()` deliberately deferred — no button was wired into the spike screen for it (Simulator has no camera, so there was nothing to test there), and the developer chose to defer the live-camera check rather than block Phase 1 exit on it. Still only unit-tested/mock-verified as of this writing.

## Not yet done

Physical-device confirmation of `captureFromCamera()` specifically — deferred by the developer, not forgotten. Low risk: it shares its permission-request/return-null-on-cancel pattern with `pickExistingPhoto()`, which is confirmed working, and `launchCameraAsync()` is the same well-established `expo-image-picker` API just pointed at the camera instead of the library.

## Conclusion

Photo-library import is fully verified end-to-end on both Simulator and a physical device (permission text, real picker UI, real asset data). Camera capture is verified only at the unit-test/mock level; the developer has explicitly deferred the live-camera physical-device check rather than blocking on it now.
