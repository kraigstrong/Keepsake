import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { parseInvitationLink } from './src/deepLinks/parseInvitationLink';
import { logError, trackEvent } from './src/observability';

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

export default function App() {
  const lastDeepLink = useLastDeepLinkResult();

  return (
    <View style={styles.container}>
      <Text>Keepsake — application shell lands in Phase 2.</Text>
      {lastDeepLink && <Text testID="deep-link-result">Last deep link: {lastDeepLink}</Text>}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
