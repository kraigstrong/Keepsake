import { createSupabaseClient } from './client';

/**
 * Unlike Sentry/PostHog (real no-ops without a DSN/key), Supabase isn't
 * optional — the app can't function without it, so a missing config
 * fails loudly at startup rather than degrading silently.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — see .env.example.',
  );
}

export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);
