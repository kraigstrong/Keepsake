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

// A bucket, not a fixed response. The sweep deletes what it lists and
// then lists again, so a mock that always returns the same object never
// terminates -- and one that ignores which objects were removed cannot
// show whether the sweep actually cleared them.
let bucket: Map<string, string[]>;

// id is nullable because Storage reports folder placeholders that way,
// and the sweep has to skip them rather than loop on them.
type StorageEntry = { id: string | null; name: string };

const list = jest.fn(
  async (prefix: string): Promise<{ data: StorageEntry[] | null; error: Error | null }> => ({
    data: (bucket.get(prefix) ?? []).slice(0, 1000).map((name) => ({ id: `id-${name}`, name })),
    error: null,
  }),
);
const remove = jest.fn(async (paths: string[]): Promise<{ error: Error | null }> => {
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const prefix = path.slice(0, slash);
    const name = path.slice(slash + 1);
    bucket.set(
      prefix,
      (bucket.get(prefix) ?? []).filter((n) => n !== name),
    );
  }
  return { error: null };
});

beforeEach(() => {
  jest.clearAllMocks();
  bucket = new Map([
    ['household-1', ['hero.jpg']],
    ['household-1/originals', ['original.jpg']],
  ]);
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

describe('a partial sweep aborts instead of proceeding', () => {
  // The sweep is the caller's last chance to delete their own files: the
  // data transaction is what makes is_household_member false. Continuing
  // past an incomplete sweep leaves objects behind *and* revokes the only
  // identity that could retry, so ADR-0028 takes the fail-loudly branch.
  it('does not delete anything when a page fails to list', async () => {
    list.mockResolvedValueOnce({ data: null, error: new Error('storage down') });

    const result = await deleteAccount('sole', 'household-1');

    expect(result.outcome).toBe('failed');
    expect(mocked.functions.invoke).not.toHaveBeenCalled();
    expect(mockedWipe).not.toHaveBeenCalled();
  });

  it('does not delete anything when a removal fails', async () => {
    remove.mockResolvedValueOnce({ error: new Error('storage down') });

    const result = await deleteAccount('sole', 'household-1');

    expect(result.outcome).toBe('failed');
    expect(mocked.functions.invoke).not.toHaveBeenCalled();
  });

  // Modelled as a real bucket rather than a fixed sequence: the sweep
  // deletes what it lists, so anything that pages with an advancing offset
  // skips objects as they shift underneath it. A mock that ignores offset
  // cannot see that -- this one removes what it is told to.
  it('removes every object even when there are more than one page', async () => {
    bucket.set(
      'household-1',
      Array.from({ length: 2300 }, (_u, i) => `hero-${i}.jpg`),
    );
    mocked.functions.invoke.mockResolvedValue({ error: null });

    const result = await deleteAccount('sole', 'household-1');

    expect(result.outcome).toBe('deleted');
    expect(bucket.get('household-1')).toEqual([]);
    expect(bucket.get('household-1/originals')).toEqual([]);
    // Three passes for 2300 objects, not one page and a shifted offset.
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it('does not spin forever on an unremovable folder placeholder', async () => {
    // Listing `<household>/` returns the `originals` folder as an entry
    // with a null id. It can never be removed, so a loop that only stops
    // on an empty page would never stop.
    list.mockResolvedValue({ data: [{ id: null, name: 'originals' }], error: null });
    mocked.functions.invoke.mockResolvedValue({ error: null });

    const result = await deleteAccount('sole', 'household-1');

    expect(result.outcome).toBe('deleted');
    expect(remove).not.toHaveBeenCalled();
  }, 10000);
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

describe('a stalled request cannot hang the flow', () => {
  // The repo's own withTimeout exists because a React Native fetch that
  // stalls never settles. Without it here the retry delay, the not-found
  // check and the sign-out are all unreachable and the screen sits on
  // "Deleting your account..." forever.
  it('treats a stalled invoke as a failure rather than waiting forever', async () => {
    jest.useFakeTimers();
    mocked.functions.invoke.mockReturnValue(new Promise(() => {}));
    mocked.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    const pending = deleteAccount('shared', null);
    // Two invoke timeouts plus the retry backoff between them.
    await jest.advanceTimersByTimeAsync(120_000);
    const result = await pending;

    expect(result.outcome).toBe('failed');
    jest.useRealTimers();
  }, 20000);
});

describe('a data-stage failure is not automatically a household change', () => {
  // Two devices racing: one verifies the user, the other deletes the auth
  // row, and the first's RPC then fails inserting its marker because the
  // row it references is gone. That is a completed deletion, not a
  // household change -- reporting 'stale' would leave a dead session
  // cached and tell the user something that did not happen.
  it('checks whether deletion actually completed before reporting stale', async () => {
    mocked.functions.invoke.mockResolvedValue({
      error: httpError({ error: 'insert or update violates foreign key', stage: 'data' }),
    });
    mocked.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error('gone'), { code: 'user_not_found' }),
    });

    const result = await deleteAccount('shared', null);

    expect(result).toEqual({ outcome: 'deleted' });
    expect(mockedWipe).toHaveBeenCalled();
  });

  it('still reports the fence as stale', async () => {
    mocked.functions.invoke.mockResolvedValue({
      error: httpError({ error: 'household membership changed since confirmation', stage: 'data' }),
    });

    const result = await deleteAccount('shared', null);

    expect(result.outcome).toBe('stale');
    expect(mockedWipe).not.toHaveBeenCalled();
  });
});

describe('the local session is always cleared', () => {
  // signOut resolves with { error } rather than throwing, so a try/catch
  // alone lets a failed logout through: no auth-state event, a still
  // cached session, and a UI left on "Deleting your account..." for an
  // account that no longer exists. The local-scope retry is the part that
  // actually has to happen.
  it('falls back to a local sign-out when the remote one reports an error', async () => {
    mocked.functions.invoke.mockResolvedValue({ error: null });
    mocked.auth.signOut
      .mockResolvedValueOnce({ error: new Error('network') })
      .mockResolvedValueOnce({ error: null });

    const result = await deleteAccount('shared', null);

    expect(result).toEqual({ outcome: 'deleted' });
    expect(mocked.auth.signOut).toHaveBeenCalledTimes(2);
    expect(mocked.auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
  });

  it('still signs out when the local wipe throws', async () => {
    mocked.functions.invoke.mockResolvedValue({ error: null });
    mockedWipe.mockRejectedValueOnce(new Error('sqlite is unhappy'));

    const result = await deleteAccount('shared', null);

    expect(result).toEqual({ outcome: 'deleted' });
    expect(mocked.auth.signOut).toHaveBeenCalled();
  });
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
