import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';

import { useReducedMotion } from '../accessibility/useReducedMotion';
import { colors, radii, spacing } from '../theme/tokens';

const ANIMATION_DURATION_MS = 250;
// Comfortably taller than any realistic sheet content, so it starts
// fully off-screen at rest regardless of what's inside.
const SHEET_OFFSCREEN_OFFSET = 400;
// Drag-to-dismiss thresholds (grabber handle only, see below) — either
// dragged far enough or flicked fast enough counts as "let go of this."
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

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
  // Tracks the grabber drag independently of `progress` (the open/close
  // animation) — added together below for the sheet's actual transform,
  // same reasoning as backdrop/sheet being independent (see above): a
  // drag in progress shouldn't fight with, or get overwritten by, the
  // open/close timing.
  const [dragY] = useState(() => new Animated.Value(0));

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
    if (!visible) {
      progress.setValue(0);
      dragY.setValue(0);
    }
  }, [visible, progress, dragY]);

  const onDragGestureEvent = Animated.event<PanGestureHandlerGestureEvent>(
    [{ nativeEvent: { translationY: dragY } }],
    { useNativeDriver: true },
  );

  function onDragHandlerStateChange(event: PanGestureHandlerStateChangeEvent) {
    if (event.nativeEvent.oldState !== State.ACTIVE) return;
    const { translationY, velocityY } = event.nativeEvent;
    if (translationY > DISMISS_DISTANCE || velocityY > DISMISS_VELOCITY) {
      onDismiss();
      return;
    }
    Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
  }

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] });
  const sheetTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_OFFSCREEN_OFFSET, 0],
  });
  // Dragging the grabber upward shouldn't lift the sheet past its
  // resting position — only positive (downward) drag moves it.
  const clampedDragY = dragY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolateLeft: 'clamp',
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
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: Animated.add(sheetTranslateY, clampedDragY) }] },
          ]}
        >
          <PanGestureHandler
            onGestureEvent={onDragGestureEvent}
            onHandlerStateChange={onDragHandlerStateChange}
          >
            <Animated.View
              style={styles.grabberHandle}
              accessibilityLabel="Drag down to close"
              testID={testID ? `${testID}-grabber` : undefined}
            >
              <View style={styles.grabber} />
            </Animated.View>
          </PanGestureHandler>
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  // A generous vertical touch/drag target around a small visual pill —
  // the pill itself stays subtle (this direction has no shadows/
  // elevation to lean on instead, per ADR-0009), the tappable area is
  // what actually needs to be easy to grab.
  grabberHandle: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.border,
  },
});
