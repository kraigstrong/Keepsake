import { Link, Tabs } from 'expo-router';
import { Text } from 'react-native';

// Primary bottom navigation per prd.md §24: This Week and Library only.
// Settings is deliberately not a tab — "Settings is secondary and does
// not require a permanent bottom tab" — reached via the header action
// below instead.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerRight: () => (
          <Link href="/settings" accessibilityLabel="Settings" accessibilityRole="button">
            <Text>Settings</Text>
          </Link>
        ),
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'This Week' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
    </Tabs>
  );
}
