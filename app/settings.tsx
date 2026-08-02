import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '../src/components/Button';
import { LoadingState } from '../src/components/LoadingState';
import { Row } from '../src/components/Row';
import {
  createInvitation,
  fetchHouseholdMembers,
  type HouseholdMember,
} from '../src/household/api';
import { useHousehold } from '../src/household/HouseholdProvider';
import { useSession } from '../src/session/SessionProvider';
import { colors, spacing, typography } from '../src/theme/tokens';

// Settings — reached via the header action in app/(tabs)/_layout.tsx, not
// a bottom tab (prd.md §24). "Few settings" per prd.md §2 — household
// membership (roster + invite) is the one real thing to expose so far;
// sign out has been here since Phase 2 as the boundary's exercised path
// back to /sign-in.
export default function SettingsScreen() {
  const { signOut } = useSession();
  const { household } = useHousehold();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!household) return;
    let cancelled = false;
    fetchHouseholdMembers(household.id).then((fetchedMembers) => {
      if (cancelled) return;
      setMembers(fetchedMembers);
      setIsLoadingMembers(false);
    });
    return () => {
      cancelled = true;
    };
  }, [household]);

  const handleInvite = async () => {
    setInviteError(null);
    setIsInviting(true);
    try {
      const { token } = await createInvitation();
      const url = Linking.createURL(`/invite/${token}`);
      await Share.share({ message: url, url });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'failed to create invitation');
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <ScrollView style={styles.container} testID="settings-placeholder">
      <Text style={styles.sectionTitle}>Household</Text>
      {isLoadingMembers ? (
        <LoadingState testID="settings-members-loading" />
      ) : (
        <View testID="settings-members-list">
          {members.map((member) => (
            <Row key={member.userId} title={member.displayName} />
          ))}
        </View>
      )}
      <View style={styles.inviteSection}>
        <Button
          testID="settings-invite-button"
          title="Invite someone"
          onPress={handleInvite}
          disabled={isInviting}
          variant="secondary"
        />
        {inviteError && (
          <Text
            style={styles.error}
            testID="settings-invite-error"
            accessible
            accessibilityRole="alert"
          >
            {inviteError}
          </Text>
        )}
      </View>
      <View style={styles.signOutSection}>
        <Button title="Sign out" onPress={() => signOut()} variant="secondary" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  inviteSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  signOutSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
