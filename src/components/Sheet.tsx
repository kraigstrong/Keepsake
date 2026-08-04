import { useEffect, useState, type ReactNode } from 'react';
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
 */
export function Sheet({ visible, onDismiss, children, testID }: SheetProps) {
  const reducedMotion = useReducedMotion();
  const [isMounted, setIsMounted] = useState(visible);
  // useState's lazy initializer (not useRef) — Animated.Value is read
  // directly during render below (its whole API contract; mutation
  // happens outside React's render cycle via .setValue()/animations,
  // never the setter), and useRef().current specifically trips
  // react-hooks/refs even though this exact pattern is correct here.
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  const [renderedVisible, setRenderedVisible] = useState(visible);

  // React's documented "adjust state during rendering" pattern, not an
  // effect: isMounted must flip true in the very same render `visible`
  // does, so the Modal appears with no one-frame gap — a setState call
  // this synchronous belongs here, not in useEffect (which exists to
  // kick off the animation itself, an imperative side effect, below).
  if (visible !== renderedVisible) {
    setRenderedVisible(visible);
    if (visible) setIsMounted(true);
  }
  // Reduced motion has no animation-completion callback to unmount
  // from once closed — same pattern, derived directly during render.
  if (reducedMotion && !visible && isMounted) {
    setIsMounted(false);
  }

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(visible ? 1 : 0);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: ANIMATION_DURATION_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setIsMounted(false);
    });
    return () => animation.stop();
  }, [visible, reducedMotion, progress]);

  if (!isMounted) return null;

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] });
  const sheetTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_OFFSCREEN_OFFSET, 0],
  });

  return (
    <Modal
      visible={isMounted}
      transparent
      animationType="none"
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
