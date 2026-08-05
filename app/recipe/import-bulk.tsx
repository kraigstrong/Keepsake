import { Stack } from 'expo-router';

import { BulkImportRecipesScreen } from '../../src/import/BulkImportRecipesScreen';

export default function BulkImportRecipesRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Import Multiple Recipes' }} />
      <BulkImportRecipesScreen />
    </>
  );
}
