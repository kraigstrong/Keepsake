import * as SecureStore from 'expo-secure-store';

/**
 * Phase 2 builds this storage + the SessionProvider/useSession() shape
 * against this minimal stub; Phase 3 replaces it with real Supabase Auth
 * data without changing the boundary's shape (see ADR-0007). Deliberately
 * generic rather than modeled on Supabase's session object — that shape
 * isn't decided yet, and guessing it now risks a redesign later.
 */
export interface Session {
  userId: string;
}

const SESSION_STORAGE_KEY = 'keepsake-session';

/**
 * Keychain-backed (expo-secure-store), not AsyncStorage — this token
 * grants access to a household's private recipe data (ADR-0007).
 */
export async function getStoredSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'userId' in parsed &&
      typeof parsed.userId === 'string'
    ) {
      return { userId: parsed.userId };
    }
    return null;
  } catch {
    return null;
  }
}

export async function storeSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}
