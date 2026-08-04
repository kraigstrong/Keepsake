import { useEffect } from 'react';

import { useSession } from './SessionProvider';
import { logError } from '../observability';

/**
 * Dev-only convenience for automated UI walkthroughs (agent or developer
 * click-throughs) — signs in automatically with a real staging test
 * account when EXPO_PUBLIC_DEV_TEST_EMAIL/_PASSWORD are set locally
 * (see scripts/create-dev-test-account.mjs). Doubly inert outside that
 * exact setup: __DEV__ is always false in any real build regardless of
 * env vars, and the vars themselves only ever live in a local
 * .env.local — never client.env or CI — so a normal dev run without
 * having explicitly run the script does nothing here either.
 *
 * Deliberately kept out of SessionProvider itself — this is scaffolding
 * for testing, not part of the real auth surface, and keeping it
 * separate means it can't accidentally complicate that well-tested file.
 */
export function useDevAutoSignIn(): void {
  const { session, isLoading, signInWithPassword } = useSession();

  useEffect(() => {
    if (!__DEV__) return;
    const email = process.env.EXPO_PUBLIC_DEV_TEST_EMAIL;
    const password = process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD;
    if (!email || !password) return;
    if (isLoading || session) return;

    signInWithPassword(email, password).then(({ error }) => {
      if (error) logError(new Error(error), { context: 'devAutoSignIn' });
    });
  }, [isLoading, session, signInWithPassword]);
}
