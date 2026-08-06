import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import { PhotoImportScreen } from './PhotoImportScreen';
import { useHousehold } from '../household/HouseholdProvider';
import { captureFromCamera, pickExistingPhoto } from '../photoImport/photoImport';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('../photoImport/photoImport', () => ({
  captureFromCamera: jest.fn(),
  pickExistingPhoto: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseHousehold = useHousehold as jest.Mock;
const mockedCaptureFromCamera = captureFromCamera as jest.Mock;
const mockedPickExistingPhoto = pickExistingPhoto as jest.Mock;
const replace = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ replace });
  mockedUseHousehold.mockReturnValue({ household: { id: 'household-1' } });
});

describe('PhotoImportScreen', () => {
  it('imports a captured photo and navigates to the resulting recipe', async () => {
    mockedCaptureFromCamera.mockResolvedValue({
      uri: 'file:///photo.jpg',
      width: 100,
      height: 200,
    });
    mockedApi.importRecipeFromPhoto.mockResolvedValue({
      jobId: 'job-1',
      recipeId: 'recipe-1',
      duplicate: false,
      uncertainFields: [],
    });

    await render(<PhotoImportScreen />);
    await fireEvent.press(screen.getByTestId('photo-import-camera'));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/recipe/recipe-1?imported=1');
    });
    expect(mockedApi.importRecipeFromPhoto).toHaveBeenCalledWith(
      'household-1',
      'file:///photo.jpg',
    );
  });

  it('imports a picked library photo and navigates to the resulting recipe', async () => {
    mockedPickExistingPhoto.mockResolvedValue({
      uri: 'file:///library.jpg',
      width: 300,
      height: 400,
    });
    mockedApi.importRecipeFromPhoto.mockResolvedValue({
      jobId: 'job-1',
      recipeId: 'recipe-2',
      duplicate: false,
      uncertainFields: [],
    });

    await render(<PhotoImportScreen />);
    await fireEvent.press(screen.getByTestId('photo-import-library'));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/recipe/recipe-2?imported=1');
    });
  });

  it('does nothing when the user cancels the picker', async () => {
    mockedCaptureFromCamera.mockResolvedValue(null);

    await render(<PhotoImportScreen />);
    await fireEvent.press(screen.getByTestId('photo-import-camera'));

    await waitFor(() => {
      expect(mockedCaptureFromCamera).toHaveBeenCalled();
    });
    expect(mockedApi.importRecipeFromPhoto).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a loading state while the import is in flight', async () => {
    mockedCaptureFromCamera.mockResolvedValue({
      uri: 'file:///photo.jpg',
      width: 100,
      height: 200,
    });
    mockedApi.importRecipeFromPhoto.mockReturnValue(new Promise(() => {})); // never resolves

    await render(<PhotoImportScreen />);
    fireEvent.press(screen.getByTestId('photo-import-camera'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-import-loading')).toBeTruthy();
    });
  });

  it('navigates to the existing recipe when the import resolves to a duplicate', async () => {
    mockedCaptureFromCamera.mockResolvedValue({
      uri: 'file:///photo.jpg',
      width: 100,
      height: 200,
    });
    mockedApi.importRecipeFromPhoto.mockResolvedValue({
      jobId: 'job-1',
      recipeId: 'existing-recipe',
      duplicate: true,
      uncertainFields: [],
    });

    await render(<PhotoImportScreen />);
    await fireEvent.press(screen.getByTestId('photo-import-camera'));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/recipe/existing-recipe?imported=1&duplicate=1');
    });
  });

  it('shows an error and lets the user retry when the import fails', async () => {
    mockedCaptureFromCamera.mockResolvedValue({
      uri: 'file:///photo.jpg',
      width: 100,
      height: 200,
    });
    mockedApi.importRecipeFromPhoto.mockRejectedValue(new Error('storage full'));

    await render(<PhotoImportScreen />);
    await fireEvent.press(screen.getByTestId('photo-import-camera'));

    await waitFor(() => {
      expect(screen.getByText('storage full')).toBeTruthy();
    });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('photo-import-camera')).not.toBeDisabled();
  });
});
