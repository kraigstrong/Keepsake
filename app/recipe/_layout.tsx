import { Stack } from 'expo-router';

import { colors } from '../../src/theme/tokens';

// Mirrors Settings' header styling (app/_layout.tsx) — these screens
// render their own in-body title per ADR-0009, so the native header
// here is just back-button chrome, not a title bar.
export default function RecipeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: () => null,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
      }}
    />
  );
}
