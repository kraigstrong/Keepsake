import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { ChevronLeftIcon } from '../../src/components/icons/ChevronLeftIcon';
import { colors } from '../../src/theme/tokens';

// Mirrors app/recipe/_layout.tsx: the screen renders its own in-body
// title (ADR-0009), so the native header here is just back-button
// chrome — explicit headerLeft rather than the platform default
// (developer UX feedback, 2026-08-07: swipe-to-go-back alone wasn't
// discoverable).
export default function GroceriesLayout() {
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
            testID="groceries-back-button"
          >
            <ChevronLeftIcon color={colors.textPrimary} size={26} />
          </Pressable>
        ),
      }}
    />
  );
}
