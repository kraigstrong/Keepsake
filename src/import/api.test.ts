import {
  createImportBatch,
  fetchBatchJobs,
  importRecipeFromPhoto,
  importRecipeFromUrl,
  submitImportJob,
} from './api';
import { trackEvent } from '../observability';
import { preserveOriginalPhoto, uploadOriginalPhoto } from '../photoImport/photoImport';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));
jest.mock('../observability', () => ({ trackEvent: jest.fn() }));
jest.mock('../photoImport/photoImport', () => ({
  preserveOriginalPhoto: jest.fn(),
  uploadOriginalPhoto: jest.fn(),
}));

const mockedInvoke = supabase.functions.invoke as jest.Mock;
const mockedTrackEvent = trackEvent as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;
const mockedPreserveOriginalPhoto = preserveOriginalPhoto as jest.Mock;
const mockedUploadOriginalPhoto = uploadOriginalPhoto as jest.Mock;

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

describe('importRecipeFromPhoto', () => {
  it('preserves, uploads, then submits the job with the resulting photoPath', async () => {
    mockedPreserveOriginalPhoto.mockResolvedValue('file:///preserved.jpg');
    mockedUploadOriginalPhoto.mockResolvedValue('household-1/originals/abc.jpg');
    mockedInvoke.mockResolvedValue({
      data: { jobId: 'j1', recipeId: 'r1', duplicate: false, uncertainFields: [] },
      error: null,
    });

    const result = await importRecipeFromPhoto('household-1', 'file:///captured.jpg');

    expect(mockedPreserveOriginalPhoto).toHaveBeenCalledWith('file:///captured.jpg');
    expect(mockedUploadOriginalPhoto).toHaveBeenCalledWith('household-1', 'file:///preserved.jpg');
    expect(mockedInvoke).toHaveBeenCalledWith('import-recipe', {
      body: { photoPath: 'household-1/originals/abc.jpg' },
    });
    expect(result).toEqual({ jobId: 'j1', recipeId: 'r1', duplicate: false, uncertainFields: [] });
    expect(mockedTrackEvent).toHaveBeenCalledWith('import_completed', {
      durationMs: expect.any(Number),
      duplicate: false,
    });
  });

  it('propagates an upload failure without calling the Edge Function, and tracks it distinctly', async () => {
    mockedPreserveOriginalPhoto.mockResolvedValue('file:///preserved.jpg');
    mockedUploadOriginalPhoto.mockRejectedValue(new Error('storage full'));

    await expect(importRecipeFromPhoto('household-1', 'file:///captured.jpg')).rejects.toThrow(
      'storage full',
    );
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedTrackEvent).toHaveBeenCalledWith('photo_import_upload_failed', {
      durationMs: expect.any(Number),
    });
  });
});

describe('submitImportJob', () => {
  it('sends jobId and clientImportId through to the Edge Function when given', async () => {
    mockedInvoke.mockResolvedValue({
      data: { jobId: 'j1', recipeId: 'r1', duplicate: false },
      error: null,
    });

    await submitImportJob({ jobId: 'j1', clientImportId: 'outbox-1' });

    expect(mockedInvoke).toHaveBeenCalledWith('import-recipe', {
      body: { jobId: 'j1', clientImportId: 'outbox-1' },
    });
  });

  it('treats a stored error on an otherwise-200 response as a failure (a replayed or pre-created failed job)', async () => {
    mockedInvoke.mockResolvedValue({
      data: { jobId: 'j1', error: 'Could not fetch the page: timed out' },
      error: null,
    });

    await expect(submitImportJob({ jobId: 'j1' })).rejects.toThrow(
      'Could not fetch the page: timed out',
    );
    expect(mockedTrackEvent).toHaveBeenCalledWith('import_failed', {
      durationMs: expect.any(Number),
    });
    expect(mockedTrackEvent).not.toHaveBeenCalledWith('import_completed', expect.anything());
  });

  it('treats a stored duplicate outcome on a 200 response as success', async () => {
    mockedInvoke.mockResolvedValue({
      data: { jobId: 'j1', recipeId: 'r1', duplicate: true },
      error: null,
    });

    const result = await submitImportJob({ jobId: 'j1' });

    expect(result).toEqual({ jobId: 'j1', recipeId: 'r1', duplicate: true });
    expect(mockedTrackEvent).toHaveBeenCalledWith('import_completed', {
      durationMs: expect.any(Number),
      duplicate: true,
    });
  });
});

describe('createImportBatch', () => {
  it('maps snake_case RPC rows to BatchJobStub', async () => {
    mockedRpc.mockResolvedValue({
      data: [
        { batch_id: 'b1', job_id: 'j1', source_url: 'https://example.com/a', status: 'processing' },
        { batch_id: 'b1', job_id: 'j2', source_url: 'https://example.com/b', status: 'processing' },
      ],
      error: null,
    });

    const result = await createImportBatch(['https://example.com/a', 'https://example.com/b']);

    expect(mockedRpc).toHaveBeenCalledWith('create_import_batch', {
      urls: ['https://example.com/a', 'https://example.com/b'],
    });
    expect(result).toEqual([
      { batchId: 'b1', jobId: 'j1', sourceUrl: 'https://example.com/a', status: 'processing' },
      { batchId: 'b1', jobId: 'j2', sourceUrl: 'https://example.com/b', status: 'processing' },
    ]);
  });

  it('emits a count-only telemetry event, never the URLs themselves', async () => {
    mockedRpc.mockResolvedValue({
      data: [
        {
          batch_id: 'b1',
          job_id: 'j1',
          source_url: 'https://secret.example.com/a',
          status: 'processing',
        },
      ],
      error: null,
    });

    await createImportBatch(['https://secret.example.com/a']);

    expect(mockedTrackEvent).toHaveBeenCalledWith('bulk_import_started', { urlCount: 1 });
    for (const call of mockedTrackEvent.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('secret.example.com');
    }
  });

  it('throws on an RPC error (e.g. the hourly cap)', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { message: "this batch would exceed the household's hourly import limit" },
    });

    await expect(createImportBatch(['https://example.com/a'])).rejects.toThrow(
      "this batch would exceed the household's hourly import limit",
    );
  });
});

describe('fetchBatchJobs', () => {
  it('queries import_jobs scoped to the given batch, oldest first', async () => {
    const order = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'j1',
          batch_id: 'b1',
          source_url: 'https://example.com/a',
          status: 'complete',
          recipe_id: 'r1',
          duplicate_of_recipe_id: null,
          error_message: null,
        },
      ],
      error: null,
    });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    mockedFrom.mockReturnValue({ select });

    const result = await fetchBatchJobs('b1');

    expect(mockedFrom).toHaveBeenCalledWith('import_jobs');
    expect(eq).toHaveBeenCalledWith('batch_id', 'b1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result).toEqual([
      {
        batchId: 'b1',
        jobId: 'j1',
        sourceUrl: 'https://example.com/a',
        status: 'complete',
        recipeId: 'r1',
        duplicate: false,
        errorMessage: undefined,
      },
    ]);
  });

  it('throws on a Supabase error', async () => {
    const order = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockedFrom.mockReturnValue({ select: () => ({ eq: () => ({ order }) }) });

    await expect(fetchBatchJobs('b1')).rejects.toThrow('boom');
  });
});
