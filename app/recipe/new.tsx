import { Stack } from 'expo-router';

import { RecipeEditorScreen } from '../../src/recipes/RecipeEditorScreen';

export default function NewRecipeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'New Recipe' }} />
      <RecipeEditorScreen />
    </>
  );
}
