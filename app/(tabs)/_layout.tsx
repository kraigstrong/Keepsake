import { Link, Tabs } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Sheet } from '../../src/components/Sheet';
import { spacing } from '../../src/theme/tokens';

// Primary bottom navigation per prd.md §24: This Week and Library only.
// Settings is deliberately not a tab — "Settings is secondary and does
// not require a permanent bottom tab" — reached via the header action
// below instead. The global add action (per the IA, reachable from both
// tabs) lives in the header too, opening a Sheet — real import options
// (URL, camera, existing photo) are Phase 8/9/10's job; this proves the
// affordance and the Sheet mechanism, not the import flow itself.
export default function TabsLayout() {
  const [addSheetVisible, setAddSheetVisible] = useState(false);

  return (
    <>
      <Tabs
        screenOptions={{
          headerLeft: () => (
            <Pressable
              onPress={() => setAddSheetVisible(true)}
              accessibilityLabel="Add recipe"
              accessibilityRole="button"
            >
              <Text>Add</Text>
            </Pressable>
          ),
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
      <Sheet
        visible={addSheetVisible}
        onDismiss={() => setAddSheetVisible(false)}
        testID="add-recipe-sheet"
      >
        <View style={{ gap: spacing.md }}>
          <Text>Importing recipes is coming soon.</Text>
          <Button title="Close" onPress={() => setAddSheetVisible(false)} variant="secondary" />
        </View>
      </Sheet>
    </>
  );
}
