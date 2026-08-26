import { Stack, useLocalSearchParams } from 'expo-router';

import { SwipeDeckScreen } from '../../src/smartSelection/SwipeDeckScreen';

export default function SwipeDeckRoute() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SwipeDeckScreen roundId={roundId} />
    </>
  );
}
