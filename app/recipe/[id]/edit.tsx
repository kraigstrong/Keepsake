import { Stack, useLocalSearchParams } from 'expo-router';

import { RecipeEditorScreen } from '../../../src/recipes/RecipeEditorScreen';

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Edit Recipe' }} />
      <RecipeEditorScreen recipeId={id} />
    </>
  );
}
