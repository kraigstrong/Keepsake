import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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

import {
  closeSelectionRound,
  finishSelectionParticipation,
  getSelectionRound,
  type SelectionRound,
} from './api';
import { describeDeadline } from './deadlinePresets';
import {
  closeEarlyNote,
  groupRole,
  nudgeMessage,
  participantName,
  progressLabel,
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
 * sheet (no push yet, #244), and Done goes back to This Week. A closed
 * round moves everyone to the results.
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
  // A load or close can land after the user has left; `replace` would
  // then act on whatever screen is on top instead of this one.
  const focusedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const fetched = await getSelectionRound(roundId);
      if (!focusedRef.current) return;
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
      focusedRef.current = true;
      void load();
      const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
      return () => {
        focusedRef.current = false;
        clearInterval(interval);
      };
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
      // Closing means the creator is done too. Only finished ballots
      // count, so without this an unfinished creator would silently drop
      // their own picks.
      const me = round?.participants.find((participant) => participant.userId === userId);
      if (me && !me.completedAt) await finishSelectionParticipation(roundId);
      await closeSelectionRound(roundId);
      if (focusedRef.current) router.replace(`/smart-selection/${roundId}/results`);
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
  // Null once the creator's account is gone (ADR-0028): then nobody can
  // close early, and only the deadline will.
  const creatorName = round.createdBy
    ? (round.participants.find((participant) => participant.userId === round.createdBy)
        ?.displayName ?? 'Whoever started it')
    : null;
  const deadline = round.closesAt ? describeDeadline(new Date(round.closesAt)) : null;
  const note = isCreator ? closeEarlyNote(round, userId) : null;
  const canKeepSwiping = me !== undefined && me.decidedCount < deckSize;
  // Nothing is left to wait for, so closing becomes the creator's next step.
  const readyToClose =
    isCreator && round.participants.every((participant) => participant.completedAt !== null);

  function title(): string {
    if (role === 'watching') return 'Picking meals';
    if (readyToClose) return "You're ready to see the matches";
    if (role === 'finished' && !isCreator) return 'Thanks for picking';
    return 'Waiting for everyone';
  }

  function subtitle(): string | null {
    if (readyToClose) return "Everyone's finished picking.";
    if (!deadline) return null;
    if (isCreator) return `Closes ${deadline}, or when you close it.`;
    // Nobody sees matches before the round closes, and there's no push to
    // say when it has (#244), so tell a finished member where to look.
    if (role === 'finished') {
      return creatorName
        ? `You'll find the matches on This Week once ${creatorName} closes the round, or ${deadline}.`
        : `You'll find the matches on This Week once the round closes ${deadline}.`;
    }
    return creatorName
      ? `${creatorName} can close it early. Otherwise it closes ${deadline}.`
      : `Closes ${deadline}.`;
  }

  const headerSubtitle = subtitle();
  const closeButton = (variant: 'primary' | 'secondary') => (
    <Button
      title="Close round & see matches"
      variant={variant}
      onPress={handleClose}
      disabled={isClosing}
      testID="waiting-close"
    />
  );

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
        <Text style={styles.title}>{title()}</Text>
        {headerSubtitle && (
          <Text style={styles.subtitle} testID="waiting-deadline">
            {headerSubtitle}
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
                  hitSlop={12}
                  style={styles.remindTarget}
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

      {/* Leaving is the default for anyone who has finished. Closing early
          is a deliberate act, so it leads only once nobody is left to wait for. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {readyToClose && closeButton('primary')}
        {role !== 'swiping' && (
          <Button
            title="Done"
            variant={readyToClose ? 'secondary' : 'primary'}
            onPress={() => router.dismissTo('/')}
            testID="waiting-dismiss"
          />
        )}
        {canKeepSwiping && (
          <Button
            title={role === 'swiping' ? 'Keep going' : 'Keep swiping'}
            variant={role === 'swiping' ? 'primary' : 'secondary'}
            onPress={() => router.replace(`/smart-selection/${roundId}`)}
            testID="waiting-keep-swiping"
          />
        )}
        {isCreator && !readyToClose && closeButton('secondary')}
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
  remindTarget: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
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
