import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { cancelSelectionRound, getSelectionRound, startSelectionRound } from './api';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
    rpc: jest.fn(),
  },
}));

const mockedInvoke = supabase.functions.invoke as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe('startSelectionRound', () => {
  it('invokes select-candidates with the request body and maps the result', async () => {
    mockedInvoke.mockResolvedValue({
      data: { roundId: 'round-1', candidateCount: 12 },
      error: null,
    });

    const result = await startSelectionRound({ mode: 'solo', targetCount: 4 });

    expect(mockedInvoke).toHaveBeenCalledWith('select-candidates', {
      body: { mode: 'solo', targetCount: 4 },
    });
    expect(result).toEqual({ roundId: 'round-1', candidateCount: 12 });
  });

  it("surfaces the Edge Function's own error message when present", async () => {
    const context = new Response(
      JSON.stringify({ error: 'a selection round is already in progress for this household' }),
    );
    mockedInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    await expect(startSelectionRound({ mode: 'solo' })).rejects.toThrow(
      'a selection round is already in progress for this household',
    );
  });

  it('falls back to the transport error message when the response body is not JSON', async () => {
    const context = new Response('not json');
    mockedInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    await expect(startSelectionRound({ mode: 'solo' })).rejects.toThrow(
      'Edge Function returned a non-2xx status code',
    );
  });

  it('surfaces the transport error message when there is no confirmed response (FunctionsFetchError)', async () => {
    mockedInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('Network request failed')),
    });

    await expect(startSelectionRound({ mode: 'solo' })).rejects.toThrow(
      'Failed to send a request to the Edge Function',
    );
  });

  it('surfaces the transport error message for a relay error, even though its context IS Response-shaped', async () => {
    // FunctionsRelayError's own context is a real Response (it has a
    // genuine x-relay-error header) — this module has no separate
    // transport-vs-http classification (unlike src/import/api.ts's
    // ImportTransportError), so both this and the fetch-error case above
    // just surface error.message unchanged.
    const context = new Response(null, { headers: { 'x-relay-error': 'true' } });
    mockedInvoke.mockResolvedValue({ data: null, error: new FunctionsRelayError(context) });

    await expect(startSelectionRound({ mode: 'solo' })).rejects.toThrow(
      'Relay Error invoking the Edge Function',
    );
  });

  it('surfaces a created-but-not-finalized round through the FunctionsHttpError body, embedded roundId and all', async () => {
    // The Edge Function returns a non-2xx status for this case (never
    // 200 with a stored error field — see startSelectionRound's own
    // JSDoc) — functions.invoke() therefore always resolves it as
    // FunctionsHttpError, same shape as any other confirmed failure.
    const context = new Response(
      JSON.stringify({
        error:
          'Round round-1 was created but could not be finalized: selection round not found, already finalized, or claim no longer held',
        roundId: 'round-1',
      }),
    );
    mockedInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    await expect(startSelectionRound({ mode: 'solo' })).rejects.toThrow(
      'Round round-1 was created but could not be finalized',
    );
  });

  it('passes group-mode fields through unchanged', async () => {
    mockedInvoke.mockResolvedValue({
      data: { roundId: 'round-2', candidateCount: 8 },
      error: null,
    });

    await startSelectionRound({
      mode: 'group',
      participantUserIds: ['user-1', 'user-2'],
      targetCount: 3,
      closesAt: '2026-08-22T20:00:00.000Z',
    });

    expect(mockedInvoke).toHaveBeenCalledWith('select-candidates', {
      body: {
        mode: 'group',
        participantUserIds: ['user-1', 'user-2'],
        targetCount: 3,
        closesAt: '2026-08-22T20:00:00.000Z',
      },
    });
  });
});

describe('getSelectionRound', () => {
  it('maps the jsonb round/participants/candidates row to camelCase', async () => {
    mockedRpc.mockResolvedValue({
      data: {
        id: 'round-1',
        household_id: 'household-1',
        created_by: 'user-1',
        mode: 'solo',
        status: 'active',
        target_count: 4,
        closes_at: null,
        candidate_strategy_version: 'filter-only-v1',
        revealed_at: null,
        created_at: '2026-08-21T10:00:00.000Z',
        updated_at: '2026-08-21T10:00:00.000Z',
        closed_at: null,
        applied_at: null,
        applied_by: null,
        applied_weekly_plan_id: null,
        participants: [{ user_id: 'user-1', completed_at: null }],
        candidates: [
          { recipe_id: 'recipe-1', score: 0, reason_codes: [], position: 0 },
          { recipe_id: 'recipe-2', score: 0, reason_codes: [], position: 1 },
        ],
      },
      error: null,
    });

    const result = await getSelectionRound('round-1');

    expect(mockedRpc).toHaveBeenCalledWith('get_selection_round', { round_id: 'round-1' });
    expect(result).toEqual({
      id: 'round-1',
      householdId: 'household-1',
      createdBy: 'user-1',
      mode: 'solo',
      status: 'active',
      targetCount: 4,
      closesAt: null,
      candidateStrategyVersion: 'filter-only-v1',
      revealedAt: null,
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
      closedAt: null,
      appliedAt: null,
      appliedBy: null,
      appliedWeeklyPlanId: null,
      participants: [{ userId: 'user-1', completedAt: null }],
      candidates: [
        { recipeId: 'recipe-1', score: 0, reasonCodes: [], position: 0 },
        { recipeId: 'recipe-2', score: 0, reasonCodes: [], position: 1 },
      ],
    });
  });

  it('throws on an RPC error (e.g. cross-household round_id)', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { message: 'selection round not found' },
    });

    await expect(getSelectionRound('round-1')).rejects.toThrow('selection round not found');
  });
});

describe('cancelSelectionRound', () => {
  it('calls cancel_selection_round with the round id', async () => {
    mockedRpc.mockResolvedValue({ data: { id: 'round-1', status: 'cancelled' }, error: null });

    await cancelSelectionRound('round-1');

    expect(mockedRpc).toHaveBeenCalledWith('cancel_selection_round', { round_id: 'round-1' });
  });

  it('throws on an RPC error (e.g. already-terminal round)', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { message: 'selection round not found or not cancellable' },
    });

    await expect(cancelSelectionRound('round-1')).rejects.toThrow(
      'selection round not found or not cancellable',
    );
  });
});
