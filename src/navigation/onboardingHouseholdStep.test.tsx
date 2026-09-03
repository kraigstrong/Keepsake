import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import OnboardingScreen from '../../app/onboarding';
import { useDeepLink } from '../deepLinks/DeepLinkProvider';
import { useHousehold } from '../household/HouseholdProvider';

/**
 * #157's state table, at the screen rather than the router. The sibling
 * `onboarding.*.test.tsx` / `inviteRoute.*.test.tsx` suites each mount
 * the whole router once per file, which is the right shape for proving a
 * route resolves but far too heavy for eight states — so the component is
 * rendered directly here with both providers stubbed.
 *
 * What every row is really checking is the same invariant: whether the
 * pending token survives. Losing it drops the invitee onto "Create a
 * household", which under ADR-0004 cannot be undone.
 */
jest.mock('../household/HouseholdProvider', () => ({
  useHousehold: jest.fn(),
}));
jest.mock('../deepLinks/DeepLinkProvider', () => ({
  useDeepLink: jest.fn(),
}));

const mockedUseHousehold = useHousehold as jest.Mock;
const mockedUseDeepLink = useDeepLink as jest.Mock;

const PROFILE = { id: 'u1', displayName: 'Alice', preferredUnitSystem: 'us_customary' as const };
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

function setup({
  profile = PROFILE as typeof PROFILE | null,
  pendingInvitationToken = null as string | null,
  acceptInvitation = jest.fn().mockResolvedValue({ outcome: 'joined' }),
  createHousehold = jest.fn().mockResolvedValue({ error: null }),
  clearPendingInvitationToken = jest.fn(),
  retryLoad = jest.fn(),
} = {}) {
  mockedUseHousehold.mockReturnValue({
    profile,
    household: null,
    isLoading: false,
    loadError: false,
    retryLoad,
    refreshHousehold: jest.fn(),
    setDisplayName: jest.fn().mockResolvedValue({ error: null }),
    createHousehold,
    acceptInvitation,
  });
  mockedUseDeepLink.mockReturnValue({
    pendingInvitationToken,
    clearPendingInvitationToken,
    capturePendingInvitationToken: jest.fn(),
  });
  return { acceptInvitation, createHousehold, clearPendingInvitationToken, retryLoad };
}

beforeEach(() => jest.clearAllMocks());

describe('T2 — signed in, no profile, invitation pending', () => {
  it('tells the invitee the link was received, a step before it is used', async () => {
    setup({ profile: null, pendingInvitationToken: TOKEN });
    await render(<OnboardingScreen />);
    expect(screen.getByTestId('onboarding-invitation-pending-note')).toBeOnTheScreen();
  });

  it('says nothing about an invitation when there is none', async () => {
    setup({ profile: null });
    await render(<OnboardingScreen />);
    expect(screen.queryByTestId('onboarding-invitation-pending-note')).toBeNull();
  });
});

describe('T7 — a transient failure keeps the invitation alive', () => {
  it('offers Retry and does not spend the token', async () => {
    const { clearPendingInvitationToken } = setup({
      pendingInvitationToken: TOKEN,
      acceptInvitation: jest
        .fn()
        .mockResolvedValue({ outcome: 'retryable', message: 'still saved' }),
    });
    await render(<OnboardingScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-retryable')).toBeOnTheScreen(),
    );
    // The whole point: a dropped connection must not look like a dead
    // invitation, because the screen behind this one is irreversible.
    expect(clearPendingInvitationToken).not.toHaveBeenCalled();
    expect(screen.queryByTestId('onboarding-create-household-button')).toBeNull();
  });

  it('retries with the same token', async () => {
    const acceptInvitation = jest
      .fn()
      .mockResolvedValueOnce({ outcome: 'retryable', message: 'still saved' })
      .mockResolvedValueOnce({ outcome: 'joined' });
    setup({ pendingInvitationToken: TOKEN, acceptInvitation });
    await render(<OnboardingScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-retry-button')).toBeOnTheScreen(),
    );
    fireEvent.press(screen.getByTestId('onboarding-invitation-retry-button'));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledTimes(2));
    expect(acceptInvitation).toHaveBeenLastCalledWith(TOKEN);
  });
});

describe('T6 — a terminal failure spends the invitation and explains why', () => {
  it('clears the token and offers a way forward', async () => {
    const { clearPendingInvitationToken } = setup({
      pendingInvitationToken: TOKEN,
      acceptInvitation: jest
        .fn()
        .mockResolvedValue({ outcome: 'terminal', message: 'This invitation has expired.' }),
    });
    await render(<OnboardingScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-terminal')).toBeOnTheScreen(),
    );
    expect(screen.getByText('This invitation has expired.')).toBeOnTheScreen();
    expect(clearPendingInvitationToken).toHaveBeenCalled();
  });
});

describe('T8 — joined, but the refresh failed', () => {
  it('never tells someone who has joined that they have not', async () => {
    const { retryLoad } = setup({
      pendingInvitationToken: TOKEN,
      acceptInvitation: jest.fn().mockResolvedValue({
        outcome: 'joined-refresh-failed',
        message: "You're in — we just couldn't load your household yet.",
      }),
    });
    await render(<OnboardingScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-joined-refresh-failed')).toBeOnTheScreen(),
    );
    // The membership row exists. Offering "Create a household" here is
    // what put a real invitee one tap from a second, unleavable household.
    expect(screen.queryByTestId('onboarding-create-household-button')).toBeNull();

    fireEvent.press(screen.getByTestId('onboarding-joined-retry-button'));
    expect(retryLoad).toHaveBeenCalled();
  });
});

describe('creating a household is never one tap', () => {
  it('confirms before creating', async () => {
    const { createHousehold } = setup();
    await render(<OnboardingScreen />);

    fireEvent.press(screen.getByTestId('onboarding-create-household-button'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-confirm-create-step')).toBeOnTheScreen(),
    );
    expect(createHousehold).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('onboarding-confirm-create-button'));
    await waitFor(() => expect(createHousehold).toHaveBeenCalledTimes(1));
  });

  it('backs out without creating', async () => {
    const { createHousehold } = setup();
    await render(<OnboardingScreen />);

    fireEvent.press(screen.getByTestId('onboarding-create-household-button'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-cancel-create-button')).toBeOnTheScreen(),
    );
    fireEvent.press(screen.getByTestId('onboarding-cancel-create-button'));

    await waitFor(() => expect(screen.getByTestId('onboarding-household-step')).toBeOnTheScreen());
    expect(createHousehold).not.toHaveBeenCalled();
  });
});

describe('an invitation can be entered by hand', () => {
  // The route that exists for the person whose link never arrived, or
  // arrived somewhere they cannot tap it. Without it their only option
  // on this screen is the irreversible one.
  it('accepts a pasted link', async () => {
    const { acceptInvitation } = setup();
    await render(<OnboardingScreen />);

    fireEvent.press(screen.getByTestId('onboarding-have-invitation-button'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-input')).toBeOnTheScreen(),
    );
    fireEvent.changeText(
      screen.getByTestId('onboarding-invitation-input'),
      `keepsake://invite/${TOKEN}`,
    );
    // The button is gated on the pasted text parsing, so wait for it to
    // become live rather than pressing a still-disabled control.
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-submit-button')).toBeEnabled(),
    );
    fireEvent.press(screen.getByTestId('onboarding-invitation-submit-button'));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith(TOKEN));
  });

  it('accepts a bare code, because that is what people can select', async () => {
    const { acceptInvitation } = setup();
    await render(<OnboardingScreen />);

    fireEvent.press(screen.getByTestId('onboarding-have-invitation-button'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-input')).toBeOnTheScreen(),
    );
    fireEvent.changeText(screen.getByTestId('onboarding-invitation-input'), `  ${TOKEN}  `);
    // The button is gated on the pasted text parsing, so wait for it to
    // become live rather than pressing a still-disabled control.
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-submit-button')).toBeEnabled(),
    );
    fireEvent.press(screen.getByTestId('onboarding-invitation-submit-button'));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith(TOKEN));
  });

  it('will not submit something that is not a token', async () => {
    const { acceptInvitation } = setup();
    await render(<OnboardingScreen />);

    fireEvent.press(screen.getByTestId('onboarding-have-invitation-button'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-invitation-input')).toBeOnTheScreen(),
    );
    fireEvent.changeText(screen.getByTestId('onboarding-invitation-input'), 'not a token');
    fireEvent.press(screen.getByTestId('onboarding-invitation-submit-button'));

    expect(acceptInvitation).not.toHaveBeenCalled();
  });
});
