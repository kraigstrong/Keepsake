import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

export type MealsOnlySurface = 'library' | 'planning';
const key = (surface: MealsOnlySurface) => `keepsake.${surface}.mealsOnly`;
const pendingWrites: Partial<Record<MealsOnlySurface, Promise<void>>> = {};

export async function readMealsOnlyPreference(surface: MealsOnlySurface): Promise<boolean> {
  await pendingWrites[surface];
  return (await AsyncStorage.getItem(key(surface)).catch(() => null)) === 'true';
}

export async function writeMealsOnlyPreference(
  surface: MealsOnlySurface,
  value: boolean,
): Promise<void> {
  // Serialize rapid toggles so a slow earlier write cannot overwrite the
  // latest choice, and let another planning screen await the settled value.
  const write = (pendingWrites[surface] ?? Promise.resolve()).then(() =>
    AsyncStorage.setItem(key(surface), String(value)).catch(() => {}),
  );
  pendingWrites[surface] = write;
  await write;
}

/** Library and planning have separate device preferences. Planning shares
 * its choice between the manual picker and Help Me Choose. */
export function useMealsOnlyPreference(surface: MealsOnlySurface, visible = true) {
  const [mealsOnly, setValue] = useState(false);
  const [ready, setReady] = useState(false);
  const changed = useRef(false);
  const [wasVisible, setWasVisible] = useState(visible);
  // A reopened sheet must hydrate the shared planning preference before
  // its start action can use it. Reset before rendering its controls.
  if (wasVisible !== visible) {
    setWasVisible(visible);
    setReady(false);
  }
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    changed.current = false;
    readMealsOnlyPreference(surface).then((value) => {
      if (!cancelled && !changed.current) setValue(value);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [surface, visible]);

  const setMealsOnly = useCallback(
    (value: boolean) => {
      changed.current = true;
      setValue(value);
      void writeMealsOnlyPreference(surface, value);
    },
    [surface],
  );
  return { mealsOnly, setMealsOnly, ready };
}
