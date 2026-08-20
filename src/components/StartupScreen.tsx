import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { KeepsakeMark } from './icons/KeepsakeMark';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import { colors } from '../theme/tokens';

const TRACK_WIDTH = 120;
const FILL_WIDTH = TRACK_WIDTH * 0.46;

/**
 * Full-screen cold-launch state, shown while session/household are still
 * resolving (AuthenticatedRouteBoundary in app/_layout.tsx) so nothing
 * routes until that's known — replaces the blank screen that used to
 * gate there. Design: "Keepsake Icon System" handoff's "Cold start —
 * syncing" splash variant, with developer-requested copy changes
 * (2026-08-20): "Restoring your library…" read as an error state, swapped
 * for "Loading your library…"; the "Offline-first" footer line was cut
 * entirely. Deliberately inverts the app's usual ink-on-paper treatment
 * (ink fills the background, paper is the foreground) —
 * reuses the existing textPrimary/background/accent tokens rather than
 * adding ink/paper aliases, since this is currently the only screen that
 * inverts them.
 */
export function StartupScreen() {
  const reducedMotion = useReducedMotion();
  const [wordmarkProgress] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [barProgress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) return;
    Animated.timing(wordmarkProgress, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, wordmarkProgress]);

  useEffect(() => {
    // Actual load duration is unpredictable (cold storage read, maybe a
    // network round trip), so an indeterminate sliding fill is honest
    // about that in a way a static percentage wouldn't be — the design
    // handoff's static 46% fill is used as-is only when reduced motion
    // is on.
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.timing(barProgress, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, barProgress]);

  const barTranslateX = barProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-FILL_WIDTH, TRACK_WIDTH],
  });

  return (
    <View style={styles.container} testID="startup-screen">
      <StatusBar style="light" />
      <KeepsakeMark color={colors.background} size={96} />
      <Animated.Text
        style={[
          styles.wordmark,
          {
            opacity: wordmarkProgress,
            transform: [
              {
                translateY: wordmarkProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          },
        ]}
      >
        Keepsake
      </Animated.Text>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            reducedMotion
              ? { width: `${(FILL_WIDTH / TRACK_WIDTH) * 100}%` }
              : { width: FILL_WIDTH, transform: [{ translateX: barTranslateX }] },
          ]}
        />
      </View>
      <Text style={styles.caption}>Loading your library…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: colors.background,
    marginTop: 26,
  },
  track: {
    width: TRACK_WIDTH,
    height: 2,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(247, 243, 236, 0.16)',
    marginTop: 34,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  caption: {
    fontSize: 12.5,
    color: 'rgba(247, 243, 236, 0.5)',
    marginTop: 14,
  },
});
