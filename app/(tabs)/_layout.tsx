import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddSheetProvider, useAddSheet } from '../../src/components/AddSheetContext';
import { Button } from '../../src/components/Button';
import { LibraryIcon } from '../../src/components/icons/LibraryIcon';
import { PlusIcon } from '../../src/components/icons/PlusIcon';
import { ThisWeekIcon } from '../../src/components/icons/ThisWeekIcon';
import { Sheet } from '../../src/components/Sheet';
import { colors, radii, spacing } from '../../src/theme/tokens';

// Primary bottom navigation per prd.md §24: This Week and Library only.
// Settings is deliberately not a tab — "Settings is secondary and does
// not require a permanent bottom tab" — reached via each screen's own
// ScreenHeader (title row) instead. It used to live in the native
// header's right slot, but a lone icon up there with nothing on the
// same row tying it to the screen's own title below read as
// disconnected from it (developer UX feedback) — moved in-body,
// alongside the title, for one cohesive header block per screen.
//
// The global add action (per the IA, reachable from both tabs) is a
// floating "+" button anchored above the tab bar, not a header action —
// a text link there ("Add"/"New Recipe") kept reading as out of place
// next to This Week's own in-body actions (developer UX feedback).
// Opens the same Sheet either way: manual creation (Phase 4), URL
// import (Phase 8), bulk URL import (Phase 9), and camera/photo import
// (Phase 10), all wired below.
//
// Native header title is hidden (headerTitle: () => null) rather than
// removed outright (headerShown: false) — even with no left/right
// content left in it, keeping the (now empty) native header bar around
// still gets safe-area handling for free instead of hand-rolling it,
// and every screen renders its own 28px title in-body regardless
// (ADR-0009).
const TAB_BAR_BASE_HEIGHT = 64;
// The design handoff's icon scale is context-specific — 32 cooking, 24
// tab bar, 20 rows, 16 inline. These had been rendering at the frame's
// 22px default, which read visibly small against the 64px bar. The FAB
// isn't a step on that scale, but 24 in a 56px circle is the standard
// ratio and keeps the whole footer on one size.
const TAB_BAR_ICON_SIZE = 24;
const FAB_SIZE = 56;
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
          tabBarActiveTintColor: colors.textPrimary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            height: TAB_BAR_BASE_HEIGHT + insets.bottom,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'This Week',
            tabBarIcon: ({ color }) => <ThisWeekIcon color={color} size={TAB_BAR_ICON_SIZE} />,
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
            tabBarIcon: ({ color }) => <LibraryIcon color={color} size={TAB_BAR_ICON_SIZE} />,
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
          {/* Import is this app's core value prop — typing a recipe in by
              hand is the least-used path, so it shouldn't be the one
              styled as the inviting rust-colored primary action
              (developer UX feedback). */}
          <Button
            title="Import from a URL"
            onPress={() => {
              closeAddSheet();
              router.push('/recipe/import');
            }}
            testID="add-recipe-import-url"
          />
          <Button
            title="Create manually"
            variant="secondary"
            onPress={() => {
              closeAddSheet();
              router.push('/recipe/new');
            }}
            testID="add-recipe-manual"
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
      <Pressable
        onPress={openAddSheet}
        accessibilityLabel="New recipe"
        accessibilityRole="button"
        hitSlop={8}
        style={[styles.fab, { bottom: TAB_BAR_BASE_HEIGHT + insets.bottom + spacing.md }]}
      >
        <PlusIcon color="#FFFFFF" size={TAB_BAR_ICON_SIZE} />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  // No shadow/elevation (Ink & Paper is flat, ADR-0009) — the solid
  // rust fill against the paper background is what keeps this readable
  // as floating above the content instead of a shadow doing that work.
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
