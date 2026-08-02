import { Alert } from 'react-native';

/**
 * Thin wrapper around RN's native Alert.alert — a native iOS alert reads
 * as "calm"/native-feeling and is inherently accessible (it's the OS's
 * own component), unlike a custom modal that would need to reinvent
 * that. Promise-based so callers can `await confirm(...)` instead of
 * threading a callback through.
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        { text: options.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: options.confirmLabel ?? 'OK',
          style: options.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
