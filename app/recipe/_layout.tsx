import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { BackIcon } from '../../src/components/icons/BackIcon';
import { colors } from '../../src/theme/tokens';

// Mirrors Settings' header styling (app/_layout.tsx) — these screens
// render their own in-body title per ADR-0009, so the native header
// here is just back-button chrome, not a title bar. headerLeft is
// explicit rather than the platform default (developer UX feedback,
// 2026-08-07: swipe-to-go-back alone wasn't discoverable).
export default function RecipeLayout() {
  const router = useRouter();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: () => null,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerLeft: () => (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            testID="recipe-back-button"
          >
            <BackIcon color={colors.textPrimary} size={26} />
          </Pressable>
        ),
      }}
    />
  );
}
