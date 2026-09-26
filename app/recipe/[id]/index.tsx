import { Stack, useLocalSearchParams } from 'expo-router';

import { RecipeDetailScreen } from '../../../src/recipes/RecipeDetailScreen';

export default function RecipeScreen() {
  const { id, imported, duplicate, fromImport } = useLocalSearchParams<{
    id: string;
    imported?: string;
    duplicate?: string;
    fromImport?: string;
  }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Recipe' }} />
      <RecipeDetailScreen
        recipeId={id}
        justImported={imported === '1'}
        wasDuplicate={duplicate === '1'}
        fromImport={fromImport === '1'}
      />
    </>
  );
}
