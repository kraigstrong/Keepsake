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
  //
  // recipeIds is untrusted route input — a deep link, a restored
  // navigation state, or a repeated query key can hand back something
  // other than the single comma-joined string ShortlistScreen always
  // sends (an array, missing entirely, or a stray empty segment from a
  // trailing comma). Coerced defensively here; ReviewScreen itself
  // re-derives against the caller's actual 'yes' decisions before
  // rendering the destructive apply action (Codex, PR #106) — this
  // route only has to not crash on a malformed param.
  const rawRecipeIds = Array.isArray(recipeIds) ? recipeIds[0] : recipeIds;
  const recipeIdList = useMemo(
    () => (rawRecipeIds ? rawRecipeIds.split(',').filter(Boolean) : []),
    [rawRecipeIds],
  );
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ReviewScreen roundId={roundId} recipeIds={recipeIdList} />
    </>
  );
}
