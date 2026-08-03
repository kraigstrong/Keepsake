import { useLocalSearchParams } from 'expo-router';

import { RecipeDetailScreen } from '../../../src/recipes/RecipeDetailScreen';

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RecipeDetailScreen recipeId={id} />;
}
