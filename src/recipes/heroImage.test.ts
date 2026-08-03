import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { pickHeroImage, stripMetadataAndResize, uploadHeroImage } from './heroImage';
import { supabase } from '../supabase/instance';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('../supabase/instance', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const mockedPicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const mockedManipulate = ImageManipulator.manipulate as jest.Mock;
const mockedStorageFrom = supabase.storage.from as jest.Mock;

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
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uploads to the recipe-images bucket under <household_id>/<random>.jpg', async () => {
    const blob = {};
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }) as never;
    const upload = jest.fn().mockResolvedValue({ error: null });
    mockedStorageFrom.mockReturnValue({ upload });

    const path = await uploadHeroImage('household-1', 'file:///hero.jpg');

    expect(mockedStorageFrom).toHaveBeenCalledWith('recipe-images');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^household-1\/[0-9a-f-]{36}\.jpg$/),
      blob,
      { contentType: 'image/jpeg', upsert: false },
    );
    expect(path).toMatch(/^household-1\/[0-9a-f-]{36}\.jpg$/);
  });

  it('throws on a Supabase storage error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve({}) }) as never;
    mockedStorageFrom.mockReturnValue({
      upload: () => Promise.resolve({ error: new Error('storage full') }),
    });

    await expect(uploadHeroImage('household-1', 'file:///hero.jpg')).rejects.toThrow(
      'storage full',
    );
  });
});
