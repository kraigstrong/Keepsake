import { Stack, useLocalSearchParams } from 'expo-router';

import { RecipeEditorScreen } from '../../../src/recipes/RecipeEditorScreen';

export default function EditRecipeScreen() {
  const { id, fromImport } = useLocalSearchParams<{ id: string; fromImport?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Edit Recipe' }} />
      <RecipeEditorScreen recipeId={id} fromImport={fromImport === '1'} />
    </>
  );
}
