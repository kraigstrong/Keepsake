import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme/tokens';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_TOAST_DURATION_MS = 3000;

export interface ToastProviderProps {
  children: ReactNode;
  // Overridable so tests can use a short real duration instead of fighting
  // fake-timer/RN timer-polyfill interaction with the default 3s.
  durationMs?: number;
}

export function ToastProvider({
  children,
  durationMs = DEFAULT_TOAST_DURATION_MS,
}: ToastProviderProps) {
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (next: string) => {
      setMessage(next);
      AccessibilityInfo.announceForAccessibility(next);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );

  // Clears a pending dismiss timer on unmount — without this, a toast
  // triggered just before navigating away leaks a timer that fires after
  // the component (and its setMessage) no longer exists.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <View style={styles.container} pointerEvents="none">
          <View style={styles.toast} role="alert" accessible>
            <Text style={styles.text}>{message}</Text>
          </View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: spacing.xl,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: {
    ...typography.body,
    color: '#FFFFFF',
  },
});
