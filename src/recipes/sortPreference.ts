import AsyncStorage from '@react-native-async-storage/async-storage';

import { SORT_MODES, type SortMode } from './librarySort';

const STORAGE_KEY = 'keepsake.library.sortMode';
const DEFAULT_MODE: SortMode = 'smart';

/** Falls back to the default on anything unreadable/unrecognized — a corrupt or stale stored value should never break the Library screen. */
export async function readSortPreference(): Promise<SortMode> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return isSortMode(stored) ? stored : DEFAULT_MODE;
}

/** Best-effort — the chosen sort still applies for the current session even if persisting it fails. */
export async function writeSortPreference(mode: SortMode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {
    // Not surfaced to the user — losing a UI preference isn't worth an
    // error state, unlike losing recipe data.
  });
}

function isSortMode(value: string | null): value is SortMode {
  return value !== null && (SORT_MODES as readonly string[]).includes(value);
}
