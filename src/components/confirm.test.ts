import { Alert } from 'react-native';

import { confirm } from './confirm';

const alertSpy = jest.spyOn(Alert, 'alert');

afterEach(() => jest.clearAllMocks());

describe('confirm', () => {
  it('passes title, message, and default button labels to Alert.alert', async () => {
    alertSpy.mockImplementation(() => {});
    confirm({ title: 'Delete recipe?', message: 'This cannot be undone.' });

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete recipe?',
      'This cannot be undone.',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'OK', style: 'default' }),
      ]),
      expect.objectContaining({ cancelable: true }),
    );
  });

  it('marks the confirm button destructive when requested', () => {
    alertSpy.mockImplementation(() => {});
    confirm({ title: 'Delete recipe?', destructive: true, confirmLabel: 'Delete' });

    const buttons = alertSpy.mock.calls[0]?.[2];
    expect(buttons).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Delete', style: 'destructive' })]),
    );
  });

  it('resolves true when the confirm button is pressed', async () => {
    alertSpy.mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.[1];
      confirmButton?.onPress?.();
    });

    await expect(confirm({ title: 'Delete recipe?' })).resolves.toBe(true);
  });

  it('resolves false when the cancel button is pressed', async () => {
    alertSpy.mockImplementation((_title, _message, buttons) => {
      const cancelButton = buttons?.[0];
      cancelButton?.onPress?.();
    });

    await expect(confirm({ title: 'Delete recipe?' })).resolves.toBe(false);
  });

  it('resolves false when the alert is dismissed without a button', async () => {
    alertSpy.mockImplementation((_title, _message, _buttons, options) => {
      (options as { onDismiss?: () => void } | undefined)?.onDismiss?.();
    });

    await expect(confirm({ title: 'Delete recipe?' })).resolves.toBe(false);
  });
});
