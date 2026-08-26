import { Stack, useLocalSearchParams } from 'expo-router';

import { ShortlistScreen } from '../../../src/smartSelection/ShortlistScreen';

export default function ShortlistRoute() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ShortlistScreen roundId={roundId} />
    </>
  );
}
