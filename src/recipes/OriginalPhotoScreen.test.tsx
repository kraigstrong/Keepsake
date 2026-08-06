import { render, screen, waitFor } from '@testing-library/react-native';

import * as heroImage from './heroImage';
import { OriginalPhotoScreen } from './OriginalPhotoScreen';

jest.mock('./heroImage');
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;

afterEach(() => jest.clearAllMocks());

describe('OriginalPhotoScreen', () => {
  it('shows a loading state, then the image once the signed url resolves', async () => {
    mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/original.jpg');

    await render(<OriginalPhotoScreen photoPath="household-1/originals/one.jpg" />);

    await waitFor(() => {
      expect(screen.getByTestId('original-photo-image')).toBeTruthy();
    });
    expect(mockedHeroImage.getHeroImageUrl).toHaveBeenCalledWith('household-1/originals/one.jpg');
  });

  it('shows an error state when the signed url fails to resolve', async () => {
    mockedHeroImage.getHeroImageUrl.mockResolvedValue(null);

    await render(<OriginalPhotoScreen photoPath="household-1/originals/one.jpg" />);

    await waitFor(() => {
      expect(screen.getByTestId('original-photo-load-error')).toBeTruthy();
    });
  });
});
