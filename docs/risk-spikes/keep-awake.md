# Risk Spike: Cooking-Mode Keep-Awake

**Phase 1.** Proves `expo-keep-awake` reliably keeps the screen on while a cooking-mode-style screen is active, before Phase 15 builds the real cooking-mode UI on top.

## Question

Does `expo-keep-awake` actually disable the iOS idle timer while active, and can it be scoped so unmounting one screen doesn't accidentally clear a keep-awake request another screen holds?

## Findings

**Tagged activation (`src/keepAwake/useCookingModeAwake.ts`)** — uses `activateKeepAwakeAsync('cooking-mode')` / `deactivateKeepAwake('cooking-mode')`, both tagged rather than the untagged global call, so this hook can only ever affect its own request, not one held elsewhere in the app.

**Verified on Simulator:** tapped "Activate keep-awake" in the spike screen → state flipped to `ACTIVE`, no crash, no console warning. `expo-keep-awake` wraps `UIApplication.isIdleTimerDisabled` on iOS — whether the screen *actually* stays on physically is not something a Simulator can prove (Simulator has no idle-sleep timer to observe), so this is flagged for the developer's physical-device pass.

**A TypeScript gotcha worth remembering:** `useEffect` cleanup functions must be synchronous, but `deactivateKeepAwake` returns `Promise<void>`. Fixed by wrapping the cleanup in a plain arrow function that calls but doesn't return the promise (fire-and-forget) — awaiting inside a `useEffect` cleanup isn't possible at all, so this pattern applies to any future async-native-call cleanup in this codebase.

## Automated evidence

`src/keepAwake/useCookingModeAwake.test.tsx` — 2 tests (activates on mount, deactivates on unmount) with the native module mocked via `renderHook`.

## Physical-device confirmation

Confirmed by the developer on 2026-08-02: activating keep-awake genuinely keeps the screen on past its normal auto-lock timeout on a real device.

## Conclusion

Verified on both Simulator (state toggling, no crash) and a physical device (the actual "screen stays on" claim, which Simulator can't represent).
