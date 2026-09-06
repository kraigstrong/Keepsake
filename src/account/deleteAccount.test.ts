import { FunctionsHttpError } from '@supabase/supabase-js';

import { deleteAccount } from './deleteAccount';
import { supabase } from '../supabase/instance';
import { wipeOfflineDataForAccountDeletion } from '../sync/wipeOfflineData';

jest.mock('../supabase/instance', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    storage: { from: jest.fn() },
    auth: { getUser: jest.fn(), signOut: jest.fn().mockResolvedValue({ error: null }) },
    rpc: jest.fn(),
  },
}));
jest.mock('../sync/wipeOfflineData', () => ({
  wipeOfflineDataForAccountDeletion: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../observability', () => ({ logError: jest.fn() }));

const mocked = supabase as unknown as {
  functions: { invoke: jest.Mock };
  storage: { from: jest.Mock };
  auth: { getUser: jest.Mock; signOut: jest.Mock };
};
const mockedWipe = wipeOfflineDataForAccountDeletion as jest.Mock;

/** A FunctionsHttpError carrying our own { error, stage } body. */
function httpError(body: Record<string, unknown>): FunctionsHttpError {
  const error = Object.create(FunctionsHttpError.prototype) as FunctionsHttpError;
  Object.assign(error, {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status: 400 }),
  });
  return error;
}

const remove = jest.fn().mockResolvedValue({ error: null });
const list = jest.fn().mockResolvedValue({ data: [{ id: 'o1', name: 'hero.jpg' }], error: null });

beforeEach(() => {
  jest.clearAllMocks();
  mocked.storage.from.mockReturnValue({ list, remove });
  mocked.auth.signOut.mockResolvedValue({ error: null });
});

describe('ordering: nothing destructive runs before the caller has confirmed', () => {
  // deleteAccount is only ever reached from behind the typed confirmation.
  // What these pin is the half that is inside its control: the sweep runs
  // for a sole member and never for a shared one, whose images belong to
  // the household that is staying.
  it('sweeps a sole member Storage before deleting anything', async () => {
    mocked.functions.invoke.mockResolvedValue({ error: null });

    await deleteAccount('sole', 'household-1');

    expect(list).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    // Before, not after: the Storage policies gate on is_household_member,
    // and the RPC is what makes that false.
    const sweepOrder = remove.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const invokeOrder = mocked.functions.invoke.mock.invocationCallOrder[0] ?? -1;
    expect(sweepOrder).toBeLessThan(invokeOrder);
  });

  it('never touches Storage for a shared member', async () => {
    mocked.functions.invoke.mockResolvedValue({ error: null });

    await deleteAccount('shared', 'household-1');

    expect(list).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('a stale confirmation is reported, not retried', () => {
  it('surfaces the fence message and leaves the device intact', async () => {
    mocked.functions.invoke.mockResolvedValue({
      error: httpError({ error: 'household membership changed since confirmation', stage: 'data' }),
    });

    const result = await deleteAccount('sole', 'household-1');

    expect(result).toEqual({
      outcome: 'stale',
      message: 'household membership changed since confirmation',
    });
    // Nothing was deleted server-side, so the local mirror must survive.
    expect(mockedWipe).not.toHaveBeenCalled();
    expect(mocked.auth.signOut).not.toHaveBeenCalled();
    expect(mocked.functions.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('completion needs positive evidence the user is gone', () => {
  it('treats a lost response as success once the auth row is confirmed absent', async () => {
    // The function deleted the row and the reply never arrived.
    mocked.functions.invoke.mockResolvedValue({ error: new Error('network') });
    mocked.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await deleteAccount('shared', null);

    expect(result).toEqual({ outcome: 'deleted' });
    expect(mockedWipe).toHaveBeenCalled();
  });

  it.each([
    ['an expired access token', { data: { user: null }, error: new Error('JWT expired') }],
    ['a revoked session', { data: { user: null }, error: new Error('session not found') }],
    ['a transient auth-service failure', { data: null, error: new Error('503') }],
  ])(
    'does not treat %s as proof of deletion',
    async (_label, getUserResult) => {
      mocked.functions.invoke.mockResolvedValue({ error: new Error('network') });
      mocked.auth.getUser.mockResolvedValue(getUserResult);

      const result = await deleteAccount('shared', null);

      // The row may well still be there. Reporting success here signs the
      // user out of an account that still exists — the compliance failure
      // the whole flow exists to prevent.
      expect(result.outcome).toBe('failed');
      expect(mockedWipe).not.toHaveBeenCalled();
      expect(mocked.auth.signOut).not.toHaveBeenCalled();
    },
    15000,
  );
});

describe('the happy path', () => {
  it('wipes local data and signs out', async () => {
    mocked.functions.invoke.mockResolvedValue({ error: null });

    const result = await deleteAccount('shared', null);

    expect(result).toEqual({ outcome: 'deleted' });
    // The deletion wipe, not the sign-out wipe: both outboxes have to go,
    // or they retry forever against a household this user has left.
    expect(mockedWipe).toHaveBeenCalled();
    expect(mocked.auth.signOut).toHaveBeenCalled();
  });

  it('retries the auth step before giving up', async () => {
    mocked.functions.invoke
      .mockResolvedValueOnce({ error: new Error('502') })
      .mockResolvedValueOnce({ error: null });
    mocked.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    const result = await deleteAccount('shared', null);

    expect(result).toEqual({ outcome: 'deleted' });
    expect(mocked.functions.invoke).toHaveBeenCalledTimes(2);
  }, 15000);
});
