import * as Linking from 'expo-linking';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
 * write is a fast local call with no server round trip. Retry is
 * literally calling handleExport() again: exportGroceriesToReminders's
 * own duplicate-protection check means only not-yet-succeeded items get
 * re-attempted.
 */
export function GroceryExportPanel({ planId, householdId, items }: GroceryExportPanelProps) {
  const { showToast } = useToast();
  const [phase, setPhase] = useState<ExportPhase>({ status: 'idle' });

  async function handleExport() {
    const permission = await requestReminderPermission();
    if (!permission.granted) {
      setPhase({ status: 'permission-denied', canAskAgain: permission.canAskAgain });
      return;
    }

    setPhase({ status: 'exporting', completed: 0, total: items.length });
    try {
      const db = await getDatabase();
      const outcome = await exportGroceriesToReminders(
        db,
        { weeklyPlanId: planId, householdId, items },
        (completed, total) => setPhase({ status: 'exporting', completed, total }),
      );
      setPhase({ status: 'done', outcome });
    } catch {
      setPhase({ status: 'idle' });
      showToast("Couldn't export to Reminders");
    }
  }

  if (phase.status === 'exporting') {
    return (
      <View style={styles.container} testID="grocery-export-panel">
        <LoadingState
          label={`Exporting ${phase.completed} of ${phase.total}…`}
          testID="grocery-export-progress"
        />
      </View>
    );
  }

  if (phase.status === 'permission-denied') {
    return (
      <View style={styles.container} testID="grocery-export-panel">
        <Text style={styles.message}>
          Keepsake needs Reminders access to export your grocery list.
        </Text>
        {phase.canAskAgain ? (
          <Button
            title="Allow Reminders Access"
            onPress={handleExport}
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
        ? `${outcome.succeeded.length} added`
        : outcome.skipped.length > 0
          ? 'Already up to date'
          : 'Nothing to add';
    const skippedText =
      outcome.skipped.length > 0 ? `, ${outcome.skipped.length} already in Reminders` : '';
    const failedText = outcome.failed.length > 0 ? `, ${outcome.failed.length} failed` : '';

    return (
      <View style={styles.container} testID="grocery-export-panel">
        <Text style={styles.message} testID="grocery-export-summary">
          {addedText}
          {skippedText}
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
          {outcome.failed.length > 0 && (
            <View style={styles.actionsRowItem}>
              <Button
                title="Retry failed items"
                onPress={handleExport}
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
        title="Export to Reminders"
        onPress={handleExport}
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
