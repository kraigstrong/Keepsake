import * as ImagePicker from 'expo-image-picker';

import { captureFromCamera, pickExistingPhoto } from './photoImport';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const mocked = ImagePicker as jest.Mocked<typeof ImagePicker>;

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
