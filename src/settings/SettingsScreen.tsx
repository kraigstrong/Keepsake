import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import type { UnitSystem } from '../../server/units/quantityVocabulary';
import { Button } from '../components/Button';
import { LoadingState } from '../components/LoadingState';
import { Row } from '../components/Row';
import {
  createInvitation,
  fetchHouseholdMembers,
  fetchProfile,
  type HouseholdMember,
  updateProfile,
} from '../household/api';
import { useHousehold } from '../household/HouseholdProvider';
import { useSession } from '../session/SessionProvider';
import { colors, spacing, typography } from '../theme/tokens';

// Settings — reached via the header action in app/(tabs)/_layout.tsx, not
// a bottom tab (prd.md §24). "Few settings" per prd.md §2 — household
// membership (roster + invite) is the one real thing to expose so far;
// sign out has been here since Phase 2 as the boundary's exercised path
// back to /sign-in. "Set a password" (ADR-0012) is opt-in — email OTP
// keeps working either way, this just adds an alternative for whoever
// wants one.
export function SettingsScreen() {
  const router = useRouter();
  const { session, signOut, setPassword } = useSession();
  const { household } = useHousehold();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [preferredUnitSystem, setPreferredUnitSystem] = useState<UnitSystem | null>(null);
  const [isSavingUnitSystem, setIsSavingUnitSystem] = useState(false);

  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

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

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    let cancelled = false;
    fetchProfile(userId).then((profile) => {
      if (!cancelled && profile) setPreferredUnitSystem(profile.preferredUnitSystem);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleSetUnitSystem = async (system: UnitSystem) => {
    const userId = session?.user.id;
    if (!userId || system === preferredUnitSystem) return;
    const previous = preferredUnitSystem;
    setPreferredUnitSystem(system);
    setIsSavingUnitSystem(true);
    try {
      await updateProfile(userId, { preferredUnitSystem: system });
    } catch {
      setPreferredUnitSystem(previous);
    } finally {
      setIsSavingUnitSystem(false);
    }
  };

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

  const handleStartSettingPassword = () => {
    setIsSettingPassword(true);
    setPasswordSuccess(false);
    setPasswordError(null);
  };

  const handleCancelSettingPassword = () => {
    setIsSettingPassword(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
  };

  const handleSavePassword = async () => {
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }

    setIsSavingPassword(true);
    const { error } = await setPassword(newPassword);
    setIsSavingPassword(false);

    if (error) {
      setPasswordError(error);
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    setIsSettingPassword(false);
    setPasswordSuccess(true);
  };

  return (
    <ScrollView style={styles.container} testID="settings-placeholder">
      <Text style={styles.sectionTitle}>Recipes</Text>
      <View testID="settings-recipes-list">
        <Row
          title="Archived Recipes"
          onPress={() => router.push('/archived-recipes')}
          testID="settings-archived-recipes-row"
        />
        <Row
          title="Recently Deleted"
          onPress={() => router.push('/recently-deleted')}
          testID="settings-recently-deleted-row"
        />
      </View>

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

      <Text style={styles.sectionTitle}>Units</Text>
      <View style={styles.unitSystemSection}>
        <View style={styles.unitSystemRow} testID="settings-unit-system-row">
          <Button
            testID="settings-unit-system-us-customary"
            title="US Customary"
            variant={preferredUnitSystem === 'us_customary' ? 'primary' : 'secondary'}
            onPress={() => handleSetUnitSystem('us_customary')}
            disabled={isSavingUnitSystem || preferredUnitSystem == null}
          />
          <Button
            testID="settings-unit-system-metric"
            title="Metric"
            variant={preferredUnitSystem === 'metric' ? 'primary' : 'secondary'}
            onPress={() => handleSetUnitSystem('metric')}
            disabled={isSavingUnitSystem || preferredUnitSystem == null}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Security</Text>
      <View style={styles.passwordSection}>
        {isSettingPassword ? (
          <>
            <TextInput
              testID="settings-new-password-input"
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={colors.textTertiary}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              textContentType="newPassword"
              editable={!isSavingPassword}
            />
            <TextInput
              testID="settings-confirm-password-input"
              style={styles.input}
              placeholder="Confirm password"
              placeholderTextColor={colors.textTertiary}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              textContentType="newPassword"
              editable={!isSavingPassword}
            />
            <Button
              testID="settings-save-password-button"
              title={isSavingPassword ? 'Saving…' : 'Save password'}
              onPress={handleSavePassword}
              disabled={
                isSavingPassword || newPassword.length === 0 || confirmPassword.length === 0
              }
            />
            <Button
              testID="settings-cancel-password-button"
              title="Cancel"
              variant="secondary"
              onPress={handleCancelSettingPassword}
              disabled={isSavingPassword}
            />
            {passwordError && (
              <Text
                style={styles.error}
                testID="settings-password-error"
                accessible
                accessibilityRole="alert"
              >
                {passwordError}
              </Text>
            )}
          </>
        ) : (
          <>
            <Button
              testID="settings-set-password-button"
              title="Set a password"
              variant="secondary"
              onPress={handleStartSettingPassword}
            />
            {passwordSuccess && (
              <Text style={styles.success} testID="settings-password-success">
                Password set — you can now sign in with it, or keep using a code.
              </Text>
            )}
          </>
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
    backgroundColor: colors.background,
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
  unitSystemSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  unitSystemRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  passwordSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  signOutSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  input: {
    ...typography.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  success: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
