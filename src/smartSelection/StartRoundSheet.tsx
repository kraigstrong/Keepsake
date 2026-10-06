import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { startSelectionRound, type StartSelectionRoundRequest } from './api';
import { DEFAULT_DEADLINE_KEY, deadlinePresets, type DeadlinePreset } from './deadlinePresets';
import { Chip } from '../components/Chip';
import { CheckIcon } from '../components/icons/CheckIcon';
import { useMealsOnlyPreference } from '../recipes/useMealsOnlyPreference';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { FLAGS } from '../featureFlags/flags';
import { fetchHouseholdMembers, type HouseholdMember } from '../household/api';
import { useHousehold } from '../household/HouseholdProvider';
import { useSession } from '../session/SessionProvider';
import { colors, radii, spacing, typography } from '../theme/tokens';

const DEFAULT_TARGET_COUNT = 4;
const MIN_TARGET_COUNT = 1;
const MAX_TARGET_COUNT = 10;

export interface StartRoundSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

type MembersState =
  { status: 'loading' } | { status: 'error' } | { status: 'loaded'; others: HouseholdMember[] };

/**
 * 1b, plus 1c ("Pick together") as a second step inside the same sheet.
 * Same local-`visible`-owned-by-parent shape as every other Sheet usage
 * in this codebase (see src/recipes/LibraryScreen.tsx's filter sheet).
 */
export function StartRoundSheet({ visible, onDismiss }: StartRoundSheetProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { session } = useSession();
  const { household } = useHousehold();
  const userId = session?.user.id ?? null;
  const groupEnabled = FLAGS.groupMealSelection === true;
  const { mealsOnly, setMealsOnly, ready } = useMealsOnlyPreference('planning', visible);
  const [targetCount, setTargetCount] = useState(DEFAULT_TARGET_COUNT);
  const [isStarting, setIsStarting] = useState(false);
  const [step, setStep] = useState<'start' | 'together'>('start');
  const [members, setMembers] = useState<MembersState>({ status: 'loading' });
  const [membersAttempt, setMembersAttempt] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<DeadlinePreset[]>([]);
  const [deadlineKey, setDeadlineKey] = useState(DEFAULT_DEADLINE_KEY);

  const householdId = household?.id ?? null;
  useEffect(() => {
    if (!visible || !groupEnabled || !householdId) return;
    let cancelled = false;
    fetchHouseholdMembers(householdId).then(
      (fetched) => {
        if (cancelled) return;
        const others = fetched
          .filter((member) => member.userId !== userId)
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        setMembers({ status: 'loaded', others });
        // Everyone is in by default; unticking is the deliberate act.
        setSelectedIds(new Set(others.map((member) => member.userId)));
      },
      () => {
        if (!cancelled) setMembers({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [visible, groupEnabled, householdId, userId, membersAttempt]);

  function adjustTargetCount(delta: number) {
    setTargetCount((current) =>
      Math.min(MAX_TARGET_COUNT, Math.max(MIN_TARGET_COUNT, current + delta)),
    );
  }

  function openTogether() {
    setPresets(deadlinePresets());
    setDeadlineKey(DEFAULT_DEADLINE_KEY);
    setStep('together');
  }

  function toggleMember(memberId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  // Every internal close goes through here so the next open starts on
  // the first step; the parent only ever flips `visible`.
  function dismiss() {
    setStep('start');
    onDismiss();
  }

  function openInvite() {
    dismiss();
    router.push('/settings');
  }

  function retryMembers() {
    setMembers({ status: 'loading' });
    setMembersAttempt((attempt) => attempt + 1);
  }

  async function start(request: StartSelectionRoundRequest) {
    setIsStarting(true);
    try {
      const { roundId } = await startSelectionRound(request);
      dismiss();
      router.push(`/smart-selection/${roundId}`);
    } catch (error) {
      // A 409-style conflict ("a selection round is already in progress
      // for this household") surfaces here as a plain thrown Error. The
      // user dismisses and retries from the entry point, which re-checks
      // getActiveSelectionRound() and resumes that round instead.
      const message = error instanceof Error ? error.message : "Couldn't start a round";
      showToast(message);
    } finally {
      setIsStarting(false);
    }
  }

  function handlePickOnMyOwn() {
    void start({ mode: 'solo', targetCount, mealsOnly });
  }

  function handleStartTogether() {
    const deadline = presets.find((preset) => preset.key === deadlineKey);
    // The sheet can sit open past "Tonight, 8 PM"; the server would
    // reject a past deadline, so refresh the choices instead.
    if (!deadline || deadline.closesAt.getTime() <= Date.now()) {
      setPresets(deadlinePresets());
      setDeadlineKey(DEFAULT_DEADLINE_KEY);
      showToast('That time has passed — pick another');
      return;
    }
    void start({
      mode: 'group',
      participantUserIds: [...selectedIds],
      targetCount,
      mealsOnly,
      closesAt: deadline.closesAt.toISOString(),
    });
  }

  const others = members.status === 'loaded' ? members.others : [];
  const canPickTogether = members.status === 'loaded' && others.length > 0;

  if (step === 'together') {
    const participantCount = selectedIds.size + 1;
    return (
      <Sheet visible={visible} onDismiss={dismiss} testID="start-round-sheet">
        <Pressable
          accessibilityRole="button"
          onPress={() => setStep('start')}
          testID="start-round-together-back"
        >
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.heading}>Pick together</Text>
        <Text style={styles.framing}>
          Everyone swipes the same recipes on their own phone. You see the matches when the round
          closes.
        </Text>

        <View style={styles.memberList}>
          <MemberRow name="You" checked locked testID="start-round-member-self" />
          {others.map((member) => (
            <MemberRow
              key={member.userId}
              name={member.displayName}
              checked={selectedIds.has(member.userId)}
              onPress={() => toggleMember(member.userId)}
              testID={`start-round-member-${member.userId}`}
            />
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={openInvite} testID="start-round-invite">
          <Text style={styles.link}>+ Invite someone to the household</Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Wrap up by</Text>
          <View style={styles.chipRow} testID="start-round-deadlines">
            {presets.map((preset) => (
              <Chip
                key={preset.key}
                label={preset.label}
                selected={preset.key === deadlineKey}
                onPress={() => setDeadlineKey(preset.key)}
                testID={`start-round-deadline-${preset.key}`}
              />
            ))}
          </View>
          <Text style={styles.caption}>
            The round closes then if you haven&apos;t closed it sooner.
          </Text>
        </View>

        <Button
          title={`Start round with ${participantCount}`}
          onPress={handleStartTogether}
          disabled={isStarting || !ready || selectedIds.size === 0}
          testID="start-round-together-start"
        />
        <Text style={[styles.caption, styles.ctaCaption]}>
          {selectedIds.size === 0
            ? 'Pick at least one other person.'
            : "They'll find it on This Week next time they open Keepsake."}
        </Text>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onDismiss={dismiss} testID="start-round-sheet">
      <Text style={styles.heading}>Help me choose</Text>
      <Text style={styles.framing}>
        {
          // "Nothing already on this week's plan" is a real hard filter
          // (select-candidates excludes it entirely). "Made lately" is
          // NOT excluded — scoreCandidates.ts only applies a recency
          // penalty, so a small library can still surface something
          // recent. Keep this worded as prioritization, not a promise of
          // exclusion (Codex, PR #104).
          "A batch of recipes, prioritizing what you haven't made in a while — nothing already on this week's plan."
        }
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Meals to find</Text>
        <View style={styles.stepperRow} testID="start-round-target-stepper">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fewer meals"
            onPress={() => adjustTargetCount(-1)}
            testID="start-round-target-decrement"
          >
            <Text style={styles.stepperButton}>−</Text>
          </Pressable>
          <Text style={styles.stepperValue}>{targetCount}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More meals"
            onPress={() => adjustTargetCount(1)}
            testID="start-round-target-increment"
          >
            <Text style={styles.stepperButton}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.caption}>Just a target — you can stop anytime.</Text>
      </View>

      {ready && (
        <Chip
          label="Meals only"
          selected={mealsOnly}
          onPress={() => setMealsOnly(!mealsOnly)}
          testID="start-round-meals-only"
        />
      )}
      <Button
        title="Pick on my own"
        onPress={handlePickOnMyOwn}
        disabled={isStarting || !ready}
        testID="start-round-solo"
      />
      {groupEnabled && (
        <View style={styles.together}>
          <Button
            title="Pick together"
            variant="outlineAccent"
            onPress={openTogether}
            disabled={isStarting || !canPickTogether}
            testID="start-round-together"
          />
          {members.status === 'loaded' && others.length === 0 && (
            <Pressable accessibilityRole="button" onPress={openInvite}>
              <Text style={styles.caption}>
                Invite someone to your household to pick together.{' '}
                <Text style={styles.link}>Invite</Text>
              </Text>
            </Pressable>
          )}
          {members.status === 'error' && (
            <Pressable
              accessibilityRole="button"
              onPress={retryMembers}
              testID="start-round-members-retry"
            >
              <Text style={styles.caption}>
                Couldn&apos;t load your household. <Text style={styles.link}>Try again</Text>
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </Sheet>
  );
}

function MemberRow({
  name,
  checked,
  locked = false,
  onPress,
  testID,
}: {
  name: string;
  checked: boolean;
  locked?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked, disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={styles.memberRow}
      testID={testID}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={styles.memberName}>{name}</Text>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked && <CheckIcon color="#FFFFFF" size={16} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  framing: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  sectionLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperButton: {
    ...typography.heading,
    color: colors.accent,
    paddingHorizontal: spacing.sm,
  },
  stepperValue: {
    ...typography.heading,
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: 'center',
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  ctaCaption: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  link: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  together: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  memberList: {
    marginBottom: spacing.sm,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  memberName: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
