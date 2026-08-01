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

## Not yet done

Physical-device confirmation of `captureFromCamera()` — Simulator has no camera, so this is inherently a device-only check, reserved for the developer per the Phase 1 exit gate.

## Conclusion

Photo-library import is fully verified end-to-end (permission text, real picker UI, real asset data). Camera capture is verified only at the unit-test/mock level; real capture needs the developer's physical-device pass.
