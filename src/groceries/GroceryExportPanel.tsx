import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { getDatabase } from '../db/database';
import {
  exportGroceriesToReminders,
  type GroceryExportItem,
  type GroceryExportOutcome,
} from '../reminders/exportGroceries';
import { openReminders, requestReminderPermission } from '../reminders/reminders';
import { Button } from '../components/Button';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { colors, spacing, typography } from '../theme/tokens';

export interface GroceryExportPanelProps {
  planId: string;
  householdId: string;
  items: readonly GroceryExportItem[];
}

type ExportPhase =
  | { status: 'idle' }
  | { status: 'permission-denied'; canAskAgain: boolean }
  | { status: 'exporting'; completed: number; total: number }
  | { status: 'done'; outcome: GroceryExportOutcome };

/**
 * GRO-03/GRO-07 (Phase 14, ADR-0023). A synchronous, in-screen action —
 * not a polling screen like ImportActivityScreen — because an EventKit
 * write is a fast local call with no server round trip. Retry re-runs
 * export only for the items that actually failed (never `partial` —
 * those already exist in Reminders, so re-attempting creation would
 * make a real, user-visible duplicate; see exportGroceries.ts).
 */
export function GroceryExportPanel({ planId, householdId, items }: GroceryExportPanelProps) {
  const { showToast } = useToast();
  const [phase, setPhase] = useState<ExportPhase>({ status: 'idle' });
  // Guards against two rapid taps both entering handleExport before the
  // first one's setPhase({status:'exporting'}) has committed — a plain
  // state check isn't enough there, since both calls can read the same
  // pre-update state while awaiting the permission response (Codex
  // review, PR #46). A ref is checked/set synchronously, before any
  // await, so the second call sees the first one's claim immediately.
  const exportInFlightRef = useRef(false);

  // If the user followed "Open Settings" and granted access there,
  // returning to the app should offer Export again rather than staying
  // stuck on the Settings prompt until the screen is revisited (Codex
  // review, PR #46). Resets to idle, not an auto-retry — exporting is
  // still only ever triggered by an explicit tap (point-of-use).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setPhase((prev) => (prev.status === 'permission-denied' ? { status: 'idle' } : prev));
      }
    });
    return () => subscription.remove();
  }, []);

  async function handleExport(itemsToExport: readonly GroceryExportItem[] = items) {
    if (exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    try {
      const permission = await requestReminderPermission();
      if (!permission.granted) {
        setPhase({ status: 'permission-denied', canAskAgain: permission.canAskAgain });
        return;
      }

      setPhase({ status: 'exporting', completed: 0, total: itemsToExport.length });
      try {
        const db = await getDatabase();
        const outcome = await exportGroceriesToReminders(
          db,
          { weeklyPlanId: planId, householdId, items: itemsToExport },
          (completed, total) => setPhase({ status: 'exporting', completed, total }),
        );
        setPhase({ status: 'done', outcome });
      } catch {
        setPhase({ status: 'idle' });
        showToast("Couldn't send to Reminders");
      }
    } finally {
      exportInFlightRef.current = false;
    }
  }

  if (phase.status === 'exporting') {
    return (
      <View style={styles.container} testID="grocery-export-panel">
        <LoadingState
          label={`Sending ${phase.completed} of ${phase.total}…`}
          testID="grocery-export-progress"
        />
      </View>
    );
  }

  if (phase.status === 'permission-denied') {
    return (
      <View style={styles.container} testID="grocery-export-panel">
        <Text style={styles.message}>
          Keepsake needs Reminders access to send your grocery list there.
        </Text>
        {phase.canAskAgain ? (
          <Button
            title="Allow Reminders Access"
            onPress={() => handleExport()}
            testID="grocery-export-retry-permission"
          />
        ) : (
          <Button
            title="Open Settings"
            onPress={() => Linking.openSettings()}
            testID="grocery-export-open-settings"
          />
        )}
      </View>
    );
  }

  if (phase.status === 'done') {
    const { outcome } = phase;
    const addedText =
      outcome.succeeded.length > 0
        ? `${outcome.succeeded.length} sent`
        : outcome.skipped.length > 0
          ? 'Already up to date'
          : 'Nothing to send';
    const skippedText =
      outcome.skipped.length > 0 ? `, ${outcome.skipped.length} already in Reminders` : '';
    const partialText =
      outcome.partial.length > 0 ? `, ${outcome.partial.length} sent but not confirmed` : '';
    const failedText = outcome.failed.length > 0 ? `, ${outcome.failed.length} failed` : '';

    const failedItems = items.filter((item) =>
      outcome.failed.some((failure) => failure.itemHash === item.itemHash),
    );

    return (
      <View style={styles.container} testID="grocery-export-panel">
        <Text style={styles.message} testID="grocery-export-summary">
          {addedText}
          {skippedText}
          {partialText}
          {failedText}
        </Text>
        <View style={styles.actionsRow}>
          <View style={styles.actionsRowItem}>
            <Button
              title="Open Reminders"
              onPress={() => openReminders()}
              variant="secondary"
              testID="grocery-export-open-reminders"
            />
          </View>
          {failedItems.length > 0 && (
            <View style={styles.actionsRowItem}>
              <Button
                title="Retry failed items"
                onPress={() => handleExport(failedItems)}
                testID="grocery-export-retry-failed"
              />
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="grocery-export-panel">
      <Button
        title="Send to Reminders"
        onPress={() => handleExport()}
        disabled={items.length === 0}
        testID="grocery-export-start"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionsRowItem: {
    flex: 1,
  },
});
