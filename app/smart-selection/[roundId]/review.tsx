import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ReviewScreen } from '../../../src/smartSelection/ReviewScreen';

export default function ReviewRoute() {
  const { roundId, recipeIds } = useLocalSearchParams<{ roundId: string; recipeIds: string }>();
  // Comma-joined UUIDs (ShortlistScreen.handleContinue) — no precedent in
  // this codebase for passing structured data between routes, and a
  // plain ordered id list doesn't need one. Memoized on the raw param so
  // ReviewScreen's own load() (keyed off this array by reference) only
  // re-runs on an actual navigation, not an unrelated re-render here.
  const recipeIdList = useMemo(() => (recipeIds ? recipeIds.split(',') : []), [recipeIds]);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ReviewScreen roundId={roundId} recipeIds={recipeIdList} />
    </>
  );
}
