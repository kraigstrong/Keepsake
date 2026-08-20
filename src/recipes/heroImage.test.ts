import { File } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  getCachedHeroImageUrl,
  getHeroImageUrl,
  getHeroImageUrls,
  pickHeroImage,
  stripMetadataAndResize,
  uploadHeroImage,
} from './heroImage';
import { supabase } from '../supabase/instance';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

jest.mock('../supabase/instance', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const mockedPicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const mockedManipulate = ImageManipulator.manipulate as jest.Mock;
const mockedStorageFrom = supabase.storage.from as jest.Mock;
const mockedFile = File as unknown as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe('pickHeroImage', () => {
  it('returns null without opening the library when permission is denied', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);

    expect(await pickHeroImage()).toBeNull();
    expect(mockedPicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('requests a square crop and returns the picked asset', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///hero.jpg', width: 800, height: 800 }],
    } as never);

    expect(await pickHeroImage()).toEqual({ uri: 'file:///hero.jpg', width: 800, height: 800 });
    expect(mockedPicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    );
  });

  it('returns null when the user cancels', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as never);

    expect(await pickHeroImage()).toBeNull();
  });
});

describe('stripMetadataAndResize', () => {
  it('resizes and re-saves as a fresh JPEG, returning the new uri', async () => {
    const renderAsync = jest.fn().mockResolvedValue({
      saveAsync: jest.fn().mockResolvedValue({ uri: 'file:///stripped.jpg' }),
    });
    const resize = jest.fn().mockReturnValue({ renderAsync });
    mockedManipulate.mockReturnValue({ resize });

    const uri = await stripMetadataAndResize('file:///hero.jpg');

    expect(mockedManipulate).toHaveBeenCalledWith('file:///hero.jpg');
    expect(resize).toHaveBeenCalledWith({ width: 1200, height: 1200 });
    expect(uri).toBe('file:///stripped.jpg');
  });
});

describe('uploadHeroImage', () => {
  afterEach(() => jest.clearAllMocks());

  it('uploads raw bytes (not a Blob) to the recipe-images bucket under <household_id>/<random>.jpg', async () => {
    const bytes = new ArrayBuffer(4);
    mockedFile.mockImplementation(() => ({ arrayBuffer: () => Promise.resolve(bytes) }));
    const upload = jest.fn().mockResolvedValue({ error: null });
    mockedStorageFrom.mockReturnValue({ upload });

    const path = await uploadHeroImage('household-1', 'file:///hero.jpg');

    expect(mockedFile).toHaveBeenCalledWith('file:///hero.jpg');
    expect(mockedStorageFrom).toHaveBeenCalledWith('recipe-images');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^household-1\/[0-9a-f-]{36}\.jpg$/),
      bytes,
      { contentType: 'image/jpeg', upsert: false },
    );
    expect(path).toMatch(/^household-1\/[0-9a-f-]{36}\.jpg$/);
  });

  it('throws on a Supabase storage error', async () => {
    mockedFile.mockImplementation(() => ({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    mockedStorageFrom.mockReturnValue({
      upload: () => Promise.resolve({ error: new Error('storage full') }),
    });

    await expect(uploadHeroImage('household-1', 'file:///hero.jpg')).rejects.toThrow(
      'storage full',
    );
  });
});

describe('getHeroImageUrl', () => {
  it('returns a signed url', async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://example.com/signed' }, error: null });
    mockedStorageFrom.mockReturnValue({ createSignedUrl });

    expect(await getHeroImageUrl('household-1/abc.jpg')).toBe('https://example.com/signed');
    expect(createSignedUrl).toHaveBeenCalledWith('household-1/abc.jpg', 3600);
  });

  it('returns null on a Supabase error instead of throwing', async () => {
    mockedStorageFrom.mockReturnValue({
      createSignedUrl: () => Promise.resolve({ data: null, error: new Error('not found') }),
    });

    expect(await getHeroImageUrl('household-1/missing.jpg')).toBeNull();
  });

  it('reuses a cached URL for the same path instead of minting a new one', async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://example.com/cached' }, error: null });
    mockedStorageFrom.mockReturnValue({ createSignedUrl });

    const first = await getHeroImageUrl('household-1/cache-me.jpg');
    const second = await getHeroImageUrl('household-1/cache-me.jpg');

    expect(first).toBe('https://example.com/cached');
    expect(second).toBe('https://example.com/cached');
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed resolution — a later call retries', async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('not found') })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://example.com/retry' }, error: null });
    mockedStorageFrom.mockReturnValue({ createSignedUrl });

    expect(await getHeroImageUrl('household-1/retry-me.jpg')).toBeNull();
    expect(await getHeroImageUrl('household-1/retry-me.jpg')).toBe('https://example.com/retry');
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
});

describe('getHeroImageUrls', () => {
  it('resolves every path in one batched call', async () => {
    const createSignedUrls = jest.fn().mockResolvedValue({
      data: [
        { path: 'household-1/a.jpg', signedUrl: 'https://example.com/a', error: null },
        { path: 'household-1/b.jpg', signedUrl: 'https://example.com/b', error: null },
      ],
      error: null,
    });
    mockedStorageFrom.mockReturnValue({ createSignedUrls });

    const result = await getHeroImageUrls(['household-1/a.jpg', 'household-1/b.jpg']);

    expect(result).toEqual({
      'household-1/a.jpg': 'https://example.com/a',
      'household-1/b.jpg': 'https://example.com/b',
    });
    expect(createSignedUrls).toHaveBeenCalledWith(['household-1/a.jpg', 'household-1/b.jpg'], 3600);
  });

  it('de-duplicates paths and skips already-cached ones', async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://example.com/cached' }, error: null });
    const createSignedUrls = jest.fn().mockResolvedValue({
      data: [{ path: 'household-1/new.jpg', signedUrl: 'https://example.com/new', error: null }],
      error: null,
    });
    mockedStorageFrom.mockReturnValue({ createSignedUrl, createSignedUrls });
    await getHeroImageUrl('household-1/already-cached.jpg');

    const result = await getHeroImageUrls([
      'household-1/already-cached.jpg',
      'household-1/already-cached.jpg',
      'household-1/new.jpg',
    ]);

    expect(result).toEqual({
      'household-1/already-cached.jpg': 'https://example.com/cached',
      'household-1/new.jpg': 'https://example.com/new',
    });
    expect(createSignedUrls).toHaveBeenCalledWith(['household-1/new.jpg'], 3600);
  });

  it('omits a path that failed to resolve, without throwing', async () => {
    mockedStorageFrom.mockReturnValue({
      createSignedUrls: () =>
        Promise.resolve({
          data: [{ path: 'household-1/ok.jpg', signedUrl: 'https://example.com/ok', error: null }],
          error: null,
        }),
    });

    const result = await getHeroImageUrls(['household-1/ok.jpg', 'household-1/missing.jpg']);

    expect(result).toEqual({ 'household-1/ok.jpg': 'https://example.com/ok' });
  });

  it('does not call Storage at all when every path is already cached', async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://example.com/cached' }, error: null });
    const createSignedUrls = jest.fn();
    mockedStorageFrom.mockReturnValue({ createSignedUrl, createSignedUrls });
    await getHeroImageUrl('household-1/already-cached.jpg');

    await getHeroImageUrls(['household-1/already-cached.jpg']);

    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe('signed URL expiry', () => {
  afterEach(() => jest.useRealTimers());

  it('treats a cached URL as expired once its lifetime has passed, and re-fetches', async () => {
    jest.useFakeTimers();
    const createSignedUrl = jest
      .fn()
      .mockResolvedValueOnce({ data: { signedUrl: 'https://example.com/first' }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://example.com/second' }, error: null });
    mockedStorageFrom.mockReturnValue({ createSignedUrl });

    expect(await getHeroImageUrl('household-1/expiring.jpg')).toBe('https://example.com/first');

    // Past the real 3600s Storage lifetime (and this cache's own earlier
    // safety-margin cutoff) — simulates a long-lived app process outliving
    // the signed URL it cached.
    jest.advanceTimersByTime(3600 * 1000 + 1000);

    expect(await getHeroImageUrl('household-1/expiring.jpg')).toBe('https://example.com/second');
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('does not resolve an expired URL from getCachedHeroImageUrl either', async () => {
    jest.useFakeTimers();
    mockedStorageFrom.mockReturnValue({
      createSignedUrl: () =>
        Promise.resolve({ data: { signedUrl: 'https://example.com/expiring' }, error: null }),
    });

    await getHeroImageUrl('household-1/peek-expiring.jpg');
    jest.advanceTimersByTime(3600 * 1000 + 1000);

    expect(getCachedHeroImageUrl('household-1/peek-expiring.jpg')).toBeNull();
  });
});

describe('getCachedHeroImageUrl', () => {
  it('returns null for a path that was never resolved', () => {
    expect(getCachedHeroImageUrl('household-1/never-fetched.jpg')).toBeNull();
  });

  it('returns the cached URL for a path resolved by getHeroImageUrl', async () => {
    mockedStorageFrom.mockReturnValue({
      createSignedUrl: () =>
        Promise.resolve({ data: { signedUrl: 'https://example.com/peeked' }, error: null }),
    });

    await getHeroImageUrl('household-1/peek-me.jpg');

    expect(getCachedHeroImageUrl('household-1/peek-me.jpg')).toBe('https://example.com/peeked');
  });
});
