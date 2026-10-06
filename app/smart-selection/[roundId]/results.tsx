import { Stack, useLocalSearchParams } from 'expo-router';

import { ResultsScreen } from '../../../src/smartSelection/ResultsScreen';

export default function ResultsRoute() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ResultsScreen roundId={roundId} />
    </>
  );
}
