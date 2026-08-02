import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Button } from 'react-native';

import { ToastProvider, useToast } from './Toast';

const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

afterEach(() => jest.clearAllMocks());

function ShowToastButton({ message }: { message: string }) {
  const { showToast } = useToast();
  return <Button title="Trigger" onPress={() => showToast(message)} />;
}

describe('useToast', () => {
  it('throws when used outside a ToastProvider', async () => {
    await expect(renderHook(() => useToast())).rejects.toThrow(
      'useToast must be used within a ToastProvider',
    );
  });
});

describe('ToastProvider', () => {
  it('shows a message with an alert role when showToast is called', async () => {
    await render(
      <ToastProvider>
        <ShowToastButton message="Saved" />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Trigger' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
    expect(screen.getByText('Saved')).toBeOnTheScreen();
  });

  it('announces the message for VoiceOver', async () => {
    await render(
      <ToastProvider>
        <ShowToastButton message="Saved" />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Trigger' }));

    await waitFor(() => expect(announceSpy).toHaveBeenCalledWith('Saved'));
  });

  it('auto-dismisses after the toast duration', async () => {
    await render(
      <ToastProvider durationMs={100}>
        <ShowToastButton message="Saved" />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Trigger' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeOnTheScreen());
  });
});
