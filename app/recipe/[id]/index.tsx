import { Stack, useLocalSearchParams } from 'expo-router';

import { RecipeDetailScreen } from '../../../src/recipes/RecipeDetailScreen';

export default function RecipeScreen() {
  const { id, imported, duplicate } = useLocalSearchParams<{
    id: string;
    imported?: string;
    duplicate?: string;
  }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Recipe' }} />
      <RecipeDetailScreen
        recipeId={id}
        justImported={imported === '1'}
        wasDuplicate={duplicate === '1'}
      />
    </>
  );
}
