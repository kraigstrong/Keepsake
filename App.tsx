import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  clearSharedImport,
  isAppGroupContainerAvailable,
  readSharedImport,
  readTestPayload,
  writeTestPayload,
} from './src/appGroup/appGroupHandoff';
import { parseInvitationLink } from './src/deepLinks/parseInvitationLink';
import { useCookingModeAwake } from './src/keepAwake/useCookingModeAwake';
import { logError, trackEvent } from './src/observability';
import { pickExistingPhoto, type PickedPhoto } from './src/photoImport/photoImport';
import {
  addGroceryReminder,
  getOrCreateGroceryList,
  requestReminderPermission,
} from './src/reminders/reminders';

// Phase 1 risk-spike wiring only — proves deep links reach the app and
// parse/reject correctly. Real UI (accept/decline screen, server call)
// is Phase 3's job; this whole effect gets replaced then, not extended.
function useLastDeepLinkResult() {
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const handle = (url: string) => {
      const parsed = parseInvitationLink(url);
      if (parsed.ok) {
        trackEvent('app_opened');
        setResult(`accepted (token length ${parsed.token.length})`);
      } else {
        logError(new Error('rejected deep link'), { reason: parsed.reason });
        setResult(`rejected: ${parsed.reason}`);
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, []);

  return result;
}

// Phase 1 risk-spike wiring only — proves the real Share Extension target
// (targets/share/ShareViewController.swift) can hand a URL to the main app
// via the App Group container. Re-checks on foreground, not just mount,
// since sharing from Safari typically resumes rather than cold-launches
// the app. Real UI (import job, save screen) is Phase 9's job.
function useSharedImport() {
  const [sharedImport, setSharedImport] = useState(() => readSharedImport());

  const check = () => setSharedImport(readSharedImport());

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, []);

  return { sharedImport, check };
}

// Phase 1 risk-spike wiring only — every section below gets replaced by
// real UI in a later phase (keep-awake -> Phase 15 cooking mode,
// photo -> Phase 4/10, reminders -> Phase 14, App Group -> Phase 9 Share
// Extension). This screen exists only so each native module can be tapped
// and verified on Simulator/device.
export default function App() {
  const lastDeepLink = useLastDeepLinkResult();
  const [awakeEnabled, setAwakeEnabled] = useState(false);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);
  const [appGroupStatus, setAppGroupStatus] = useState<string | null>(null);
  const { sharedImport, check: checkSharedImport } = useSharedImport();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text>Keepsake — application shell lands in Phase 2.</Text>
      {lastDeepLink && <Text testID="deep-link-result">Last deep link: {lastDeepLink}</Text>}

      <View style={styles.spikeSection}>
        <Text>Keep-awake spike: {awakeEnabled ? 'ACTIVE' : 'inactive'}</Text>
        <Button
          title={awakeEnabled ? 'Deactivate keep-awake' : 'Activate keep-awake'}
          onPress={() => setAwakeEnabled((v) => !v)}
        />
        {awakeEnabled && <KeepAwakeActive />}
      </View>

      <View style={styles.spikeSection}>
        <Text>Photo spike: {photo ? `picked (${photo.width}x${photo.height})` : 'none'}</Text>
        <Button
          title="Pick existing photo"
          onPress={async () => {
            const result = await pickExistingPhoto();
            setPhoto(result);
          }}
        />
      </View>

      <View style={styles.spikeSection}>
        <Text>Reminders spike: {reminderStatus ?? 'not tried'}</Text>
        <Button
          title="Add test grocery reminder"
          onPress={async () => {
            try {
              const granted = await requestReminderPermission();
              if (!granted) {
                setReminderStatus('permission denied');
                return;
              }
              const listId = await getOrCreateGroceryList();
              await addGroceryReminder(listId, `Keepsake spike test item (${Date.now()})`);
              setReminderStatus('reminder created');
            } catch (error) {
              logError(error, { spike: 'reminders' });
              setReminderStatus(`error: ${String(error)}`);
            }
          }}
        />
      </View>

      <View style={styles.spikeSection}>
        <Text>App Group spike: {appGroupStatus ?? 'not tried'}</Text>
        <Button
          title="Write + read App Group payload"
          onPress={() => {
            if (!isAppGroupContainerAvailable()) {
              setAppGroupStatus('container unavailable');
              return;
            }
            const value = `keepsake-app-group-test ${Date.now()}`;
            const wrote = writeTestPayload(value);
            const readBack = readTestPayload();
            setAppGroupStatus(
              wrote && readBack === value ? `round-tripped (${readBack})` : 'round-trip mismatch',
            );
          }}
        />
      </View>

      <View style={styles.spikeSection}>
        <Text>
          Share Extension spike:{' '}
          {sharedImport
            ? `received ${sharedImport.url} (at ${sharedImport.receivedAt})`
            : 'nothing shared yet — use Safari’s Share Sheet'}
        </Text>
        <Button title="Check for shared import" onPress={checkSharedImport} />
        {sharedImport && (
          <Button
            title="Clear shared import"
            onPress={() => {
              clearSharedImport();
              checkSharedImport();
            }}
          />
        )}
      </View>

      <StatusBar style="auto" />
    </ScrollView>
  );
}

function KeepAwakeActive() {
  useCookingModeAwake();
  return null;
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 40,
  },
  spikeSection: {
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
  },
});
