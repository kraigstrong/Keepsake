import { fireEvent, render, screen } from '@testing-library/react-native';

import { SignInScreen } from './SignInScreen';
import { useSession } from './SessionProvider';

jest.mock('./SessionProvider', () => ({ useSession: jest.fn() }));

const mockedUseSession = useSession as jest.Mock;

const sendOtp = jest.fn();
const verifyOtp = jest.fn();
const signInWithPassword = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseSession.mockReturnValue({ sendOtp, verifyOtp, signInWithPassword });
});

describe('email code flow', () => {
  it('sends a code and moves to the code step', async () => {
    sendOtp.mockResolvedValue({ error: null });

    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-send-code-button'));

    expect(sendOtp).toHaveBeenCalledWith('alice@example.test');
    expect(screen.getByTestId('sign-in-code-input')).toBeTruthy();
    expect(screen.getByText('Enter the code we sent to alice@example.test')).toBeTruthy();
  });

  it('shows an error and stays on the email step when sending a code fails', async () => {
    sendOtp.mockResolvedValue({ error: 'rate limited' });

    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-send-code-button'));

    expect(screen.getByTestId('sign-in-error')).toHaveTextContent('rate limited');
    expect(screen.queryByTestId('sign-in-code-input')).toBeNull();
  });

  it('verifies the code', async () => {
    sendOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });

    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-send-code-button'));
    await fireEvent.changeText(screen.getByTestId('sign-in-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('sign-in-verify-button'));

    expect(verifyOtp).toHaveBeenCalledWith('alice@example.test', '123456');
  });

  it('returns to the email step from the code step', async () => {
    sendOtp.mockResolvedValue({ error: null });

    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-send-code-button'));
    await fireEvent.press(screen.getByTestId('sign-in-change-email-button'));

    expect(screen.getByTestId('sign-in-email-input')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-code-input')).toBeNull();
  });
});

describe('password flow (ADR-0012)', () => {
  it('switches to the password step without sending a code', async () => {
    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-use-password-button'));

    expect(sendOtp).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-in-password-input')).toBeTruthy();
    expect(screen.getByText('Sign in to alice@example.test')).toBeTruthy();
  });

  it('signs in with a password', async () => {
    signInWithPassword.mockResolvedValue({ error: null });

    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-use-password-button'));
    await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'hunter22aardvark');
    await fireEvent.press(screen.getByTestId('sign-in-with-password-button'));

    expect(signInWithPassword).toHaveBeenCalledWith('alice@example.test', 'hunter22aardvark');
  });

  it('shows an error when the password is wrong', async () => {
    signInWithPassword.mockResolvedValue({ error: 'Invalid login credentials' });

    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-use-password-button'));
    await fireEvent.changeText(screen.getByTestId('sign-in-password-input'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('sign-in-with-password-button'));

    expect(screen.getByTestId('sign-in-error')).toHaveTextContent('Invalid login credentials');
  });

  it('returns to the email step from the password step', async () => {
    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email-input'), 'alice@example.test');
    await fireEvent.press(screen.getByTestId('sign-in-use-password-button'));
    await fireEvent.press(screen.getByTestId('sign-in-use-code-button'));

    expect(screen.getByTestId('sign-in-email-input')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-password-input')).toBeNull();
  });
});
