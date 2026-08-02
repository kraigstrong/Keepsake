import { createSupabaseClient } from './client';

describe('createSupabaseClient', () => {
  it('constructs a configured Supabase client from literal config', () => {
    const client = createSupabaseClient('https://example.supabase.co', 'anon-key');

    expect(client).toBeTruthy();
    expect(typeof client.auth.signInWithOtp).toBe('function');
    expect(typeof client.auth.verifyOtp).toBe('function');
    expect(typeof client.rpc).toBe('function');
  });
});
