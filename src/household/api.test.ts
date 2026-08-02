import {
  acceptInvitation,
  createHousehold,
  createInvitation,
  createProfile,
  fetchHousehold,
  fetchHouseholdMembers,
  fetchProfile,
} from './api';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe('fetchProfile', () => {
  it('returns the profile when one exists', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: 'user-1', display_name: 'Alice' }, error: null }),
        }),
      }),
    });

    await expect(fetchProfile('user-1')).resolves.toEqual({ id: 'user-1', displayName: 'Alice' });
    expect(mockedFrom).toHaveBeenCalledWith('profiles');
  });

  it('returns null when no profile row exists', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    });

    await expect(fetchProfile('user-1')).resolves.toBeNull();
  });

  it('throws on a Supabase error', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: new Error('boom') }),
        }),
      }),
    });

    await expect(fetchProfile('user-1')).rejects.toThrow('boom');
  });
});

describe('createProfile', () => {
  it('inserts a profile row for the given user', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockedFrom.mockReturnValue({ insert });

    await createProfile('user-1', 'Alice');

    expect(mockedFrom).toHaveBeenCalledWith('profiles');
    expect(insert).toHaveBeenCalledWith({ id: 'user-1', display_name: 'Alice' });
  });

  it('throws on a Supabase error', async () => {
    mockedFrom.mockReturnValue({ insert: () => Promise.resolve({ error: new Error('boom') }) });

    await expect(createProfile('user-1', 'Alice')).rejects.toThrow('boom');
  });
});

describe('fetchHousehold', () => {
  it('returns the household when the caller has one', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        maybeSingle: () => Promise.resolve({ data: { id: 'household-1' }, error: null }),
      }),
    });

    await expect(fetchHousehold()).resolves.toEqual({ id: 'household-1' });
  });

  it('returns null when the caller has no household', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    });

    await expect(fetchHousehold()).resolves.toBeNull();
  });
});

describe('createHousehold', () => {
  it('calls the create_household RPC and returns the new household', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'household-1' }, error: null });
    mockedRpc.mockReturnValue({ single });

    await expect(createHousehold()).resolves.toEqual({ id: 'household-1' });
    expect(mockedRpc).toHaveBeenCalledWith('create_household');
  });

  it('throws on a Supabase error', async () => {
    mockedRpc.mockReturnValue({
      single: () => Promise.resolve({ data: null, error: new Error('boom') }),
    });

    await expect(createHousehold()).rejects.toThrow('boom');
  });
});

describe('createInvitation', () => {
  it('calls the create_invitation RPC and returns the token', async () => {
    const single = jest
      .fn()
      .mockResolvedValue({
        data: { token: 'tok', expires_at: '2026-01-01T00:00:00Z' },
        error: null,
      });
    mockedRpc.mockReturnValue({ single });

    await expect(createInvitation()).resolves.toEqual({
      token: 'tok',
      expiresAt: '2026-01-01T00:00:00Z',
    });
    expect(mockedRpc).toHaveBeenCalledWith('create_invitation');
  });
});

describe('acceptInvitation', () => {
  it('calls the accept_invitation RPC with the raw token', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'household-1' }, error: null });
    mockedRpc.mockReturnValue({ single });

    await expect(acceptInvitation('raw-token')).resolves.toEqual({ id: 'household-1' });
    expect(mockedRpc).toHaveBeenCalledWith('accept_invitation', { raw_token: 'raw-token' });
  });

  it('throws on a Supabase error (e.g. expired/invalid/already-used)', async () => {
    mockedRpc.mockReturnValue({
      single: () => Promise.resolve({ data: null, error: new Error('invitation has expired') }),
    });

    await expect(acceptInvitation('raw-token')).rejects.toThrow('invitation has expired');
  });
});

describe('fetchHouseholdMembers', () => {
  it('joins membership and profile rows for the household', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'household_membership') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
                error: null,
              }),
          }),
        };
      }
      return {
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [
                { id: 'user-1', display_name: 'Alice' },
                { id: 'user-2', display_name: 'Bob' },
              ],
              error: null,
            }),
        }),
      };
    });

    await expect(fetchHouseholdMembers('household-1')).resolves.toEqual([
      { userId: 'user-1', displayName: 'Alice' },
      { userId: 'user-2', displayName: 'Bob' },
    ]);
  });

  it('returns an empty array without a second query when the household has no members', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    });

    await expect(fetchHouseholdMembers('household-1')).resolves.toEqual([]);
    expect(mockedFrom).toHaveBeenCalledTimes(1);
  });
});
