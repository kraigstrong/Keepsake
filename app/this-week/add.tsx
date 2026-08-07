import { Stack, useLocalSearchParams } from 'expo-router';

import { AddToThisWeekScreen } from '../../src/thisWeek/AddToThisWeekScreen';

export default function AddToThisWeekRoute() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AddToThisWeekScreen planId={planId} />
    </>
  );
}
