import { fireEvent, render, screen } from '@testing-library/react-native';

import { SettingsScreen } from './SettingsScreen';
import * as householdApi from '../household/api';
import { useHousehold } from '../household/HouseholdProvider';
import { useSession } from '../session/SessionProvider';

jest.mock('../household/api');
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('../session/SessionProvider', () => ({ useSession: jest.fn() }));
// ../household/api is auto-mocked above, but Jest still loads the real
// module once to derive its shape — which would otherwise trip
// src/supabase/instance.ts's missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedHouseholdApi = householdApi as jest.Mocked<typeof householdApi>;
const mockedUseHousehold = useHousehold as jest.Mock;
const mockedUseSession = useSession as jest.Mock;

const signOut = jest.fn();
const setPassword = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseHousehold.mockReturnValue({ household: { id: 'household-1' } });
  mockedUseSession.mockReturnValue({ signOut, setPassword });
  mockedHouseholdApi.fetchHouseholdMembers.mockResolvedValue([]);
});

describe('set a password (ADR-0012)', () => {
  it('reveals the password form and saves it', async () => {
    setPassword.mockResolvedValue({ error: null });

    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByTestId('settings-set-password-button'));

    await fireEvent.changeText(
      screen.getByTestId('settings-new-password-input'),
      'correct-horse-battery',
    );
    await fireEvent.changeText(
      screen.getByTestId('settings-confirm-password-input'),
      'correct-horse-battery',
    );
    await fireEvent.press(screen.getByTestId('settings-save-password-button'));

    expect(setPassword).toHaveBeenCalledWith('correct-horse-battery');
    expect(screen.getByTestId('settings-password-success')).toBeTruthy();
    expect(screen.queryByTestId('settings-new-password-input')).toBeNull();
  });

  it('rejects mismatched passwords without calling setPassword', async () => {
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByTestId('settings-set-password-button'));
    await fireEvent.changeText(screen.getByTestId('settings-new-password-input'), 'password-one');
    await fireEvent.changeText(
      screen.getByTestId('settings-confirm-password-input'),
      'password-two',
    );
    await fireEvent.press(screen.getByTestId('settings-save-password-button'));

    expect(setPassword).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-password-error')).toHaveTextContent(
      "Passwords don't match.",
    );
  });

  it('surfaces the Supabase error and stays on the form', async () => {
    setPassword.mockResolvedValue({ error: 'Password should be at least 8 characters' });

    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByTestId('settings-set-password-button'));
    await fireEvent.changeText(screen.getByTestId('settings-new-password-input'), 'short1');
    await fireEvent.changeText(screen.getByTestId('settings-confirm-password-input'), 'short1');
    await fireEvent.press(screen.getByTestId('settings-save-password-button'));

    expect(screen.getByTestId('settings-password-error')).toHaveTextContent(
      'Password should be at least 8 characters',
    );
    expect(screen.getByTestId('settings-new-password-input')).toBeTruthy();
  });

  it('cancels back to the collapsed state', async () => {
    await render(<SettingsScreen />);

    await fireEvent.press(screen.getByTestId('settings-set-password-button'));
    await fireEvent.changeText(screen.getByTestId('settings-new-password-input'), 'password-one');
    await fireEvent.press(screen.getByTestId('settings-cancel-password-button'));

    expect(screen.queryByTestId('settings-new-password-input')).toBeNull();
    expect(screen.getByTestId('settings-set-password-button')).toBeTruthy();
  });
});
