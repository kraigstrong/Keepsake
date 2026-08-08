import { Stack, useLocalSearchParams } from 'expo-router';

import { GroceryReviewScreen } from '../../src/groceries/GroceryReviewScreen';

export default function GroceriesRoute() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Groceries' }} />
      <GroceryReviewScreen planId={planId} />
    </>
  );
}
