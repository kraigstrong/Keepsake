import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  captureFromCamera,
  pickExistingPhoto,
  preserveOriginalPhoto,
  uploadOriginalPhoto,
} from './photoImport';
import { supabase } from '../supabase/instance';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('../supabase/instance', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const mocked = ImagePicker as jest.Mocked<typeof ImagePicker>;
const mockedManipulate = ImageManipulator.manipulate as jest.Mock;
const mockedStorageFrom = supabase.storage.from as jest.Mock;

describe('captureFromCamera', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns null without launching the camera when permission is denied', async () => {
    mocked.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as never);

    const result = await captureFromCamera();

    expect(result).toBeNull();
    expect(mocked.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('returns null when the user cancels', async () => {
    mocked.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as never);
    mocked.launchCameraAsync.mockResolvedValue({ canceled: true } as never);

    expect(await captureFromCamera()).toBeNull();
  });

  it('returns the picked photo on success', async () => {
    mocked.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as never);
    mocked.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.jpg', width: 100, height: 200 }],
    } as never);

    expect(await captureFromCamera()).toEqual({
      uri: 'file:///photo.jpg',
      width: 100,
      height: 200,
    });
  });
});

describe('pickExistingPhoto', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns null without opening the library when permission is denied', async () => {
    mocked.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false } as never);

    const result = await pickExistingPhoto();

    expect(result).toBeNull();
    expect(mocked.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns the picked photo on success', async () => {
    mocked.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
    mocked.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library.jpg', width: 300, height: 400 }],
    } as never);

    expect(await pickExistingPhoto()).toEqual({
      uri: 'file:///library.jpg',
      width: 300,
      height: 400,
    });
  });
});

describe('preserveOriginalPhoto', () => {
  afterEach(() => jest.clearAllMocks());

  it('resizes at a larger cap/quality than the hero-image path and strips metadata via re-encode', async () => {
    const renderAsync = jest.fn().mockResolvedValue({
      saveAsync: jest.fn().mockResolvedValue({ uri: 'file:///preserved.jpg' }),
    });
    const resize = jest.fn().mockReturnValue({ renderAsync });
    mockedManipulate.mockReturnValue({ resize });

    const uri = await preserveOriginalPhoto('file:///captured.jpg');

    expect(mockedManipulate).toHaveBeenCalledWith('file:///captured.jpg');
    expect(resize).toHaveBeenCalledWith({ width: 2400, height: 2400 });
    expect(uri).toBe('file:///preserved.jpg');
  });
});

describe('uploadOriginalPhoto', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('uploads to the recipe-images bucket under <household_id>/originals/<random>.jpg', async () => {
    const blob = {};
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }) as never;
    const upload = jest.fn().mockResolvedValue({ error: null });
    mockedStorageFrom.mockReturnValue({ upload });

    const path = await uploadOriginalPhoto('household-1', 'file:///preserved.jpg');

    expect(mockedStorageFrom).toHaveBeenCalledWith('recipe-images');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^household-1\/originals\/[0-9a-f-]{36}\.jpg$/),
      blob,
      { contentType: 'image/jpeg', upsert: false },
    );
    expect(path).toMatch(/^household-1\/originals\/[0-9a-f-]{36}\.jpg$/);
  });

  it('throws on a Supabase storage error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve({}) }) as never;
    mockedStorageFrom.mockReturnValue({
      upload: () => Promise.resolve({ error: new Error('storage full') }),
    });

    await expect(uploadOriginalPhoto('household-1', 'file:///preserved.jpg')).rejects.toThrow(
      'storage full',
    );
  });
});
