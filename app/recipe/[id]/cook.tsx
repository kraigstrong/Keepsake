import { Stack, useLocalSearchParams } from 'expo-router';

import { CookingModeScreen } from '../../../src/cooking/CookingModeScreen';

export default function CookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Cooking' }} />
      <CookingModeScreen recipeId={id} />
    </>
  );
}
