import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DeleteAccountSection } from './DeleteAccountSection';
import { deleteAccount, prepareAccountDeletion } from '../account/deleteAccount';

jest.mock('../account/deleteAccount', () => ({
  prepareAccountDeletion: jest.fn(),
  deleteAccount: jest.fn(),
}));
jest.mock('../observability', () => ({ logError: jest.fn() }));

const mockedPrepare = prepareAccountDeletion as jest.Mock;
const mockedDelete = deleteAccount as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrepare.mockResolvedValue({ mode: 'sole', householdId: 'household-1' });
  mockedDelete.mockResolvedValue({ outcome: 'deleted' });
});

async function openConfirmation() {
  await render(<DeleteAccountSection />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-delete-account-button'));
  });
  await waitFor(() =>
    expect(screen.getByTestId('settings-delete-account-confirm')).toBeOnTheScreen(),
  );
}

describe('the screen says which deletion this is before asking', () => {
  // The two outcomes differ in what the person loses, so "are you sure?"
  // without saying which is asking for consent to something unstated.
  it.each([
    ['sole', 'also deletes it'],
    ['shared', 'stay with the people still in it'],
    ['no_household', 'deletes your account and nothing else'],
  ])('spells out the %s case', async (mode, phrase) => {
    mockedPrepare.mockResolvedValue({ mode, householdId: 'household-1' });
    await openConfirmation();

    expect(
      String(screen.getByTestId('settings-delete-account-consequence').props.children),
    ).toContain(phrase);
  });
});

describe('nothing destructive happens until the phrase is typed', () => {
  it('keeps the confirm button disabled until it matches', async () => {
    await openConfirmation();

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-confirm-button'));
    });
    expect(mockedDelete).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('settings-delete-account-input'), 'del');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-confirm-button'));
    });
    expect(mockedDelete).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('settings-delete-account-input'), 'delete');
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-delete-account-confirm-button')).toBeEnabled(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-confirm-button'));
    });
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('sole', 'household-1'));
  });

  // The failure this exists to prevent: an earlier design swept Storage
  // while the confirmation was on screen, so cancelling cost a sole member
  // every photo they had and left the account they had just declined to
  // delete perfectly intact.
  it('costs nothing to change your mind', async () => {
    await openConfirmation();

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-cancel-button'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('settings-delete-account-button')).toBeOnTheScreen(),
    );
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('forgets what was typed when reopened', async () => {
    await openConfirmation();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('settings-delete-account-input'), 'delete');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-cancel-button'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-delete-account-button')).toBeOnTheScreen(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-button'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-delete-account-confirm')).toBeOnTheScreen(),
    );
    expect(screen.getByTestId('settings-delete-account-confirm-button')).toBeDisabled();
  });
});

describe('the sweep acts on the server answer, not local state', () => {
  // A device sitting on onboarding can have household === null while
  // another device has already created one. prepare correctly says
  // 'sole'; taking the id from local state would skip the sweep and
  // orphan every image behind a deletion that has just revoked the only
  // permission that could remove them.
  it('passes the household id prepare returned, not the one this device knows', async () => {
    mockedPrepare.mockResolvedValue({ mode: 'sole', householdId: 'from-the-server' });
    await openConfirmation();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('settings-delete-account-input'), 'delete');
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-delete-account-confirm-button')).toBeEnabled(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-confirm-button'));
    });

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('sole', 'from-the-server'));
  });
});

describe('a household that changed underneath the confirmation', () => {
  it('sends the user back to start rather than acting on a stale answer', async () => {
    mockedDelete.mockResolvedValue({ outcome: 'stale', message: 'changed' });
    await openConfirmation();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('settings-delete-account-input'), 'delete');
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-delete-account-confirm-button')).toBeEnabled(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-delete-account-confirm-button'));
    });

    await waitFor(() =>
      expect(String(screen.getByTestId('settings-delete-account-error').props.children)).toContain(
        'Your household changed while you were confirming',
      ),
    );
    // Back at the start, with the typed phrase cleared -- a second attempt
    // has to be confirmed against the mode that is now true.
    expect(screen.getByTestId('settings-delete-account-button')).toBeOnTheScreen();
  });
});
