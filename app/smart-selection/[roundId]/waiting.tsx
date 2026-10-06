import { Stack, useLocalSearchParams } from 'expo-router';

import { WaitingScreen } from '../../../src/smartSelection/WaitingScreen';

export default function WaitingRoute() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <WaitingScreen roundId={roundId} />
    </>
  );
}
