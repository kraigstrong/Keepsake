import { importRecipeFromUrl } from './api';
import { trackEvent } from '../observability';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));
jest.mock('../observability', () => ({ trackEvent: jest.fn() }));

const mockedInvoke = supabase.functions.invoke as jest.Mock;
const mockedTrackEvent = trackEvent as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe('importRecipeFromUrl', () => {
  it('returns the import result on success', async () => {
    mockedInvoke.mockResolvedValue({
      data: { jobId: 'j1', recipeId: 'r1', duplicate: false, uncertainFields: [] },
      error: null,
    });

    const result = await importRecipeFromUrl('https://example.com/recipe');

    expect(result).toEqual({ jobId: 'j1', recipeId: 'r1', duplicate: false, uncertainFields: [] });
    expect(mockedInvoke).toHaveBeenCalledWith('import-recipe', {
      body: { url: 'https://example.com/recipe' },
    });
    expect(mockedTrackEvent).toHaveBeenCalledWith('import_completed', {
      durationMs: expect.any(Number),
      duplicate: false,
    });
  });

  it('reports duplicate: true in telemetry when the import resolved to an existing recipe', async () => {
    mockedInvoke.mockResolvedValue({
      data: { jobId: 'j1', recipeId: 'r1', duplicate: true, uncertainFields: [] },
      error: null,
    });

    await importRecipeFromUrl('https://example.com/recipe');

    expect(mockedTrackEvent).toHaveBeenCalledWith('import_completed', {
      durationMs: expect.any(Number),
      duplicate: true,
    });
  });

  it("surfaces the Edge Function's own error message when present", async () => {
    const context = new Response(
      JSON.stringify({ error: 'Could not find enough recipe content on this page' }),
    );
    mockedInvoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }),
    });

    await expect(importRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      'Could not find enough recipe content on this page',
    );
    expect(mockedTrackEvent).toHaveBeenCalledWith('import_failed', {
      durationMs: expect.any(Number),
    });
    expect(mockedTrackEvent).not.toHaveBeenCalledWith('import_completed', expect.anything());
  });

  it('falls back to the transport error message when the response body is not JSON', async () => {
    const context = new Response('not json');
    mockedInvoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }),
    });

    await expect(importRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      'Edge Function returned a non-2xx status code',
    );
  });

  it('falls back to the transport error message when there is no context at all', async () => {
    mockedInvoke.mockResolvedValue({ data: null, error: new Error('Network request failed') });

    await expect(importRecipeFromUrl('https://example.com/recipe')).rejects.toThrow(
      'Network request failed',
    );
  });

  it('never includes the imported URL in telemetry, success or failure', async () => {
    mockedInvoke.mockResolvedValue({
      data: { jobId: 'j1', recipeId: 'r1', duplicate: false, uncertainFields: [] },
      error: null,
    });
    await importRecipeFromUrl('https://secret-family-recipes.example.com/grandmas-pie');

    mockedInvoke.mockResolvedValue({ data: null, error: new Error('boom') });
    await importRecipeFromUrl('https://secret-family-recipes.example.com/grandmas-pie').catch(
      () => {},
    );

    for (const call of mockedTrackEvent.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('secret-family-recipes');
    }
  });
});
