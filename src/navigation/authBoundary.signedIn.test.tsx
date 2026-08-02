import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

// See authBoundary.signedOut.test.tsx for why this is a separate file.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
(SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{"userId":"test-user"}');

describe('authenticated route boundary — signed in', () => {
  it('shows This Week instead of sign-in', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('this-week-placeholder')).toBeOnTheScreen();
    });
  });
});
