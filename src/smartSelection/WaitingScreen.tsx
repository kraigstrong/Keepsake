import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { closeSelectionRound, getSelectionRound, type SelectionRound } from './api';
import { describeDeadline } from './deadlinePresets';
import {
  closeEarlyNote,
  groupRole,
  nudgeMessage,
  participantName,
  progressLabel,
  unfinishedOthers,
} from './groupRound';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../components/Toast';
import { CheckIcon } from '../components/icons/CheckIcon';
import { useSession } from '../session/SessionProvider';
import { colors, radii, spacing, typography } from '../theme/tokens';

// No Realtime in this app (ADR-0021), so the waiting screen refetches:
// on focus, on returning to the app, on pull-down, and on this interval
// while it's on screen.
const REFRESH_INTERVAL_MS = 20_000;

export interface WaitingScreenProps {
  roundId: string;
}

/**
 * 1h — who's finished and who's still swiping in a group round. The
 * creator can close early; anyone can remind the others through the share
 * sheet (no push yet, #244). A closed round moves everyone to the results.
 */
export function WaitingScreen({ roundId }: WaitingScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [round, setRound] = useState<SelectionRound | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const load = useCallback(async () => {
    try {
      const fetched = await getSelectionRound(roundId);
      if (fetched.status === 'ready_for_review' || fetched.status === 'applied') {
        router.replace(`/smart-selection/${roundId}/results`);
        return;
      }
      if (fetched.status === 'cancelled') {
        showToast('That round was cancelled');
        router.dismissTo('/');
        return;
      }
      setRound(fetched);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [roundId, router, showToast]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [load]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => subscription.remove();
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  async function handleClose() {
    setIsClosing(true);
    try {
      await closeSelectionRound(roundId);
      router.replace(`/smart-selection/${roundId}/results`);
    } catch {
      // Most often the deadline closed it a moment earlier; reloading
      // takes everyone to the results in that case.
      showToast("Couldn't close the round");
      setIsClosing(false);
      void load();
    }
  }

  function share(message: string) {
    Share.share({ message }).catch(() => {});
  }

  if (loadError && !round) {
    return (
      <View style={styles.screen} testID="waiting-screen">
        <ErrorState
          title="Couldn't load the round"
          message="Check your connection and try again."
          onRetry={() => void load()}
          testID="waiting-load-error"
        />
      </View>
    );
  }

  if (!round) {
    return (
      <View style={styles.screen} testID="waiting-screen">
        <LoadingState label="Checking on everyone…" testID="waiting-loading" />
      </View>
    );
  }

  const role = groupRole(round, userId);
  const isCreator = round.createdBy === userId;
  const deckSize = round.candidates.length;
  const me = round.participants.find((participant) => participant.userId === userId);
  const unfinished = unfinishedOthers(round, userId);
  const creatorName =
    round.participants.find((participant) => participant.userId === round.createdBy)?.displayName ??
    'Whoever started it';
  const deadline = round.closesAt ? describeDeadline(new Date(round.closesAt)) : null;
  const note = isCreator ? closeEarlyNote(round, userId) : null;
  const canKeepSwiping = me !== undefined && me.decidedCount < deckSize;

  return (
    <View style={styles.screen} testID="waiting-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.dismissTo('/')}
          accessibilityRole="button"
          testID="waiting-done"
        >
          <Text style={styles.headerAction}>This Week</Text>
        </Pressable>
        <Text style={styles.title}>
          {role === 'watching' ? 'Picking meals' : 'Waiting for everyone'}
        </Text>
        {deadline && (
          <Text style={styles.subtitle} testID="waiting-deadline">
            {isCreator
              ? `Closes ${deadline}, or when you close it.`
              : `${creatorName} can close it early. Otherwise it closes ${deadline}.`}
          </Text>
        )}
      </View>

      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        testID="waiting-list"
      >
        {round.participants.map((participant) => {
          const finished = participant.completedAt !== null;
          const isMe = participant.userId === userId;
          const name = participantName(participant, userId);
          return (
            <View
              key={participant.userId}
              style={styles.row}
              testID={`waiting-participant-${participant.userId}`}
            >
              <View style={[styles.status, finished && styles.statusFinished]}>
                {finished && <CheckIcon color="#FFFFFF" size={14} />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{name}</Text>
                <Text style={styles.rowProgress}>{progressLabel(participant, deckSize)}</Text>
              </View>
              {!finished && !isMe && (
                <Pressable
                  onPress={() => share(nudgeMessage(round))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remind ${name}`}
                  hitSlop={8}
                  testID={`waiting-remind-${participant.userId}`}
                >
                  <Text style={styles.remind}>Remind</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        {note && (
          <Text style={styles.note} testID="waiting-close-early-note">
            {note}
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {canKeepSwiping && (
          <Button
            title={role === 'swiping' ? 'Keep going' : 'Keep swiping'}
            variant={isCreator ? 'secondary' : 'primary'}
            onPress={() => router.replace(`/smart-selection/${roundId}`)}
            testID="waiting-keep-swiping"
          />
        )}
        {isCreator && (
          <Button
            title="Close round & see matches"
            onPress={handleClose}
            disabled={isClosing}
            testID="waiting-close"
          />
        )}
        {unfinished.length > 0 && (
          <Button
            title="Nudge everyone"
            variant="secondary"
            onPress={() => share(nudgeMessage(round))}
            testID="waiting-nudge"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  headerAction: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  status: {
    width: 22,
    height: 22,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusFinished: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  rowProgress: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  remind: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
});
