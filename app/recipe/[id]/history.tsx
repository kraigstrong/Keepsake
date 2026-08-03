import { useLocalSearchParams } from 'expo-router';

import { RecipeVersionHistoryScreen } from '../../../src/recipes/RecipeVersionHistoryScreen';

export default function RecipeHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RecipeVersionHistoryScreen recipeId={id} />;
}
