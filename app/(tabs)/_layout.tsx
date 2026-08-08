import { Link, Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddSheetProvider, useAddSheet } from '../../src/components/AddSheetContext';
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
// (Phase 4), URL import (Phase 8), bulk URL import (Phase 9), and
// camera/photo import (Phase 10) are all wired below.
//
// Native header title is hidden (headerTitle: () => null) rather than
// removed outright (headerShown: false) — each screen renders its own
// 28px title in-body per the Ink & Paper direction (ADR-0009), but
// keeping the native header bar around still gets safe-area handling
// and the left/right action slots for free instead of hand-rolling them.
export default function TabsLayout() {
  return (
    <AddSheetProvider>
      <TabsLayoutContent />
    </AddSheetProvider>
  );
}

function TabsLayoutContent() {
  const router = useRouter();
  const { isVisible: addSheetVisible, open: openAddSheet, close: closeAddSheet } = useAddSheet();
  const insets = useSafeAreaInsets();

  return (
    <>
      <Tabs
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTitle: () => null,
          // Matches every screen's own paddingHorizontal: spacing.lg — the
          // native header's left/right slots default to flush against the
          // screen edge otherwise, which read as clipped/unreachable next
          // to the notch or Dynamic Island (developer UX feedback).
          headerLeftContainerStyle: { paddingLeft: spacing.lg },
          headerRightContainerStyle: { paddingRight: spacing.lg },
          headerLeft: () => (
            <Pressable
              onPress={openAddSheet}
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
      <Sheet visible={addSheetVisible} onDismiss={() => closeAddSheet()} testID="add-recipe-sheet">
        <View style={{ gap: spacing.md }}>
          <Button
            title="Create manually"
            onPress={() => {
              closeAddSheet();
              router.push('/recipe/new');
            }}
            testID="add-recipe-manual"
          />
          <Button
            title="Import from a URL"
            variant="secondary"
            onPress={() => {
              closeAddSheet();
              router.push('/recipe/import');
            }}
            testID="add-recipe-import-url"
          />
          <Button
            title="Import multiple URLs"
            variant="secondary"
            onPress={() => {
              closeAddSheet();
              router.push('/recipe/import-bulk');
            }}
            testID="add-recipe-import-bulk"
          />
          <Button
            title="Import from a photo"
            variant="secondary"
            onPress={() => {
              closeAddSheet();
              router.push('/recipe/import-photo');
            }}
            testID="add-recipe-import-photo"
          />
          <Button title="Close" onPress={() => closeAddSheet()} variant="secondary" />
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
