import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

/**
 * COOK-02: screen stays on during cooking mode. Tagged so this hook can
 * never accidentally clear a keep-awake request some other screen holds —
 * each caller only ever activates/deactivates its own tag.
 *
 * Native module (expo-keep-awake wraps UIApplication.isIdleTimerDisabled
 * on iOS) — nothing here is pure logic worth unit-testing beyond "does it
 * call the right functions on mount/unmount", which is what
 * useCookingModeAwake.test.tsx checks with the native call mocked.
 * Whether the screen *actually* stays on is a Simulator/device check,
 * not a Jest one.
 */
const COOKING_MODE_TAG = 'cooking-mode';

export function useCookingModeAwake(): void {
  useEffect(() => {
    activateKeepAwakeAsync(COOKING_MODE_TAG);
    // Both calls are async (Promise<void>), but a useEffect cleanup must
    // be synchronous — fire-and-forget rather than await.
    return () => {
      deactivateKeepAwake(COOKING_MODE_TAG);
    };
  }, []);
}
