import { Stack } from 'expo-router';

import { ImportRecipeScreen } from '../../src/import/ImportRecipeScreen';

export default function ImportRecipeRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Import Recipe' }} />
      <ImportRecipeScreen />
    </>
  );
}
