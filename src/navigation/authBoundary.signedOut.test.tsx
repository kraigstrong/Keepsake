import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

// Deliberately lives outside app/ (see navigation.test.tsx for why), and
// deliberately its own file rather than a second describe block alongside
// authBoundary.signedIn.test.tsx — renderRouter's real render() is only
// reliable once per test file (see navigation.test.tsx for the
// underlying version-mismatch bugs this works around).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
(SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

describe('authenticated route boundary — signed out', () => {
  it('redirects to sign-in instead of showing the tabs', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('sign-in-placeholder')).toBeOnTheScreen();
    });
  });
});
