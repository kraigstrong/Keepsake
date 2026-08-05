import { importRecipeFromUrl } from './api';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const mockedInvoke = supabase.functions.invoke as jest.Mock;

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
});
