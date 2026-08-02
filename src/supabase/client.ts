import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { LargeSecureStore } from './secureStore';

/**
 * Pure factory (config as parameters, not read from process.env here) so
 * it stays testable against literal values — babel-preset-expo statically
 * inlines EXPO_PUBLIC_* at build time, which defeats mocking process.env
 * in tests (see src/observability/sentry.ts for the same pattern).
 */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      storage: new LargeSecureStore(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
