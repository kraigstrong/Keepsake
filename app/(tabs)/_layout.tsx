import { Link, Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../src/components/Button';
import { LibraryIcon } from '../../src/components/icons/LibraryIcon';
import { ThisWeekIcon } from '../../src/components/icons/ThisWeekIcon';
import { Sheet } from '../../src/components/Sheet';
import { colors, spacing, typography } from '../../src/theme/tokens';

// Primary bottom navigation per prd.md §24: This Week and Library only.
// Settings is deliberately not a tab — "Settings is secondary and does
// not require a permanent bottom tab" — reached via the header action
// below instead. The global add action (per the IA, reachable from both
// tabs) lives in the header too, opening a Sheet — manual creation
// (Phase 4) is wired below; real import options (URL, camera, existing
// photo) are Phase 8/9/10's job and still show as coming soon.
//
// Native header title is hidden (headerTitle: () => null) rather than
// removed outright (headerShown: false) — each screen renders its own
// 28px title in-body per the Ink & Paper direction (ADR-0009), but
// keeping the native header bar around still gets safe-area handling
// and the left/right action slots for free instead of hand-rolling them.
export default function TabsLayout() {
  const router = useRouter();
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <>
      <Tabs
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTitle: () => null,
          headerLeft: () => (
            <Pressable
              onPress={() => setAddSheetVisible(true)}
              accessibilityLabel="Add recipe"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.headerAction}>Add</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Link href="/settings" accessibilityLabel="Settings" accessibilityRole="button">
              <Text style={styles.headerAction}>Settings</Text>
            </Link>
          ),
          tabBarActiveTintColor: colors.textPrimary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            height: 64 + insets.bottom,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'This Week',
            tabBarIcon: ({ color }) => <ThisWeekIcon color={color} />,
            tabBarLabel: ({ focused, color }) => (
              <Text style={[styles.tabLabel, focused && styles.tabLabelActive, { color }]}>
                This Week
              </Text>
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Library',
            tabBarIcon: ({ color }) => <LibraryIcon color={color} />,
            tabBarLabel: ({ focused, color }) => (
              <Text style={[styles.tabLabel, focused && styles.tabLabelActive, { color }]}>
                Library
              </Text>
            ),
          }}
        />
      </Tabs>
      <Sheet
        visible={addSheetVisible}
        onDismiss={() => setAddSheetVisible(false)}
        testID="add-recipe-sheet"
      >
        <View style={{ gap: spacing.md }}>
          <Button
            title="Create manually"
            onPress={() => {
              setAddSheetVisible(false);
              router.push('/recipe/new');
            }}
            testID="add-recipe-manual"
          />
          <Text>Importing from a URL, camera, or photo is coming soon.</Text>
          <Button title="Close" onPress={() => setAddSheetVisible(false)} variant="secondary" />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  headerAction: {
    ...typography.body,
    color: colors.textPrimary,
  },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
