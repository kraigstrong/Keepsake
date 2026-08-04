import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '../accessibility/useReducedMotion';
import { colors, radii, spacing } from '../theme/tokens';

const ANIMATION_DURATION_MS = 250;
// Comfortably taller than any realistic sheet content, so it starts
// fully off-screen at rest regardless of what's inside.
const SHEET_OFFSCREEN_OFFSET = 400;

export interface SheetProps {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  testID?: string;
}

/**
 * The backdrop dim and the sheet's slide-up are animated independently
 * here, not via Modal's built-in animationType="slide" — that built-in
 * animation slides the *entire* modal, backdrop included, up from
 * off-screen, which reads as the dim itself rising rather than already
 * covering the screen while only the sheet content slides in.
 *
 * Modal's own `visible` prop is passed straight through, never gated
 * behind local state — Modal already has its own internal lifecycle for
 * staying rendered through a native dismiss transition (see
 * react-native's Modal.js: `state.isRendered`, tied to a native
 * 'modalDismissed' event on iOS). An earlier version of this component
 * added a second, hand-rolled "stay mounted during close" layer on top
 * of that, which meant fully unmounting and remounting the *real*
 * native Modal on every open/close cycle instead of just toggling its
 * `visible` prop — broke after exactly one open on a real device
 * (worked once, then every subsequent press did nothing), never caught
 * by Jest since RTL doesn't exercise a real native Modal's lifecycle.
 *
 * The open animation starts from Modal's `onShow` callback, not a plain
 * effect keyed on `visible` — starting it immediately races the native
 * modal's own presentation (a separate native window on iOS), and the
 * 250ms JS animation can finish before the modal is even attached to
 * the screen, so all you see is the end state. `onShow` fires only
 * once the native modal has actually finished presenting.
 *
 * Closing resets `progress` instantly instead of animating it: Modal
 * can remove its children as soon as `visible` goes false (immediately
 * in tests; on a real device it may linger briefly for its own native
 * dismiss transition, but that's not guaranteed), and starting a new
 * native-driven `Animated.timing` on a view that's already gone crashes
 * ("unable to find node on an unmounted component"). A plain
 * `setValue` never touches the native view connection, so it's safe
 * regardless of whether Modal has already torn the view down.
 */
export function Sheet({ visible, onDismiss, children, testID }: SheetProps) {
  const reducedMotion = useReducedMotion();
  // useState's lazy initializer (not useRef) — Animated.Value is read
  // directly during render below (its whole API contract; mutation
  // happens outside React's render cycle via .setValue()/animations,
  // never the setter), and useRef().current specifically trips
  // react-hooks/refs even though this exact pattern is correct here.
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));

  const openAnimated = useCallback(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: ANIMATION_DURATION_MS,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, progress]);

  useEffect(() => {
    // Opening is triggered by onShow below instead — see the comment
    // above for why starting it here doesn't work.
    if (!visible) progress.setValue(0);
  }, [visible, progress]);

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] });
  const sheetTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_OFFSCREEN_OFFSET, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onShow={openAnimated}
      onRequestClose={onDismiss}
      testID={testID}
    >
      <View style={styles.container}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
        />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: '#000',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
  },
});
