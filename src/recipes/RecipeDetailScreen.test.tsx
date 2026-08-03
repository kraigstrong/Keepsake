import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Linking } from 'react-native';

import * as api from './api';
import * as heroImage from './heroImage';
import { RecipeDetailScreen } from './RecipeDetailScreen';

jest.mock('./api');
jest.mock('./heroImage');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;
const mockedUseRouter = useRouter as jest.Mock;

const push = jest.fn();

const recipe: api.Recipe = {
  id: 'recipe-1',
  title: 'Herb Roast Chicken',
  heroImagePath: 'household-1/existing.jpg',
  activeTimeMinutes: 20,
  totalTimeMinutes: 70,
  yieldText: 'Serves 4',
  permanentNotes: 'Great with potatoes.',
  sourceUrl: 'https://example.com/recipe',
  sourceAttribution: 'Grandma',
  tags: ['weeknight'],
  categoryIds: ['cat-protein-chicken'],
  ingredientSections: [{ title: null, lines: ['1 whole chicken', '2 tbsp butter'] }],
  instructionSections: [{ title: null, lines: ['Preheat the oven.', 'Roast it.'] }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push });
  mockedApi.fetchCategories.mockResolvedValue([
    { id: 'cat-protein-chicken', groupName: 'protein', value: 'Chicken' },
  ]);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

it('shows a loading state, then the recipe', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);
  mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/existing.jpg');

  await render(<RecipeDetailScreen recipeId="recipe-1" />);

  expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();
  expect(screen.getByText('Active 20 min · Total 70 min · Serves 4')).toBeTruthy();
  expect(screen.getByTestId('recipe-detail-category-Chicken')).toBeTruthy();
  expect(screen.getByTestId('recipe-detail-tag-weeknight')).toBeTruthy();
  expect(screen.getByText('1 whole chicken', { exact: false })).toBeTruthy();
  expect(screen.getByText('2. Roast it.')).toBeTruthy();
  expect(screen.getByText('Great with potatoes.')).toBeTruthy();
  expect(screen.getByText('Grandma')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());
});

it('shows an error state when the recipe fails to load', async () => {
  mockedApi.fetchRecipe.mockRejectedValue(new Error('not found'));

  await render(<RecipeDetailScreen recipeId="missing" />);

  expect(screen.getByTestId('recipe-detail-load-error')).toBeTruthy();
});

it('navigates to the edit screen', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await render(<RecipeDetailScreen recipeId="recipe-1" />);

  await fireEvent.press(screen.getByTestId('recipe-detail-edit-button'));

  expect(push).toHaveBeenCalledWith('/recipe/recipe-1/edit');
});

it('opens the source url in the browser', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await render(<RecipeDetailScreen recipeId="recipe-1" />);

  await fireEvent.press(screen.getByTestId('recipe-detail-source-url'));

  expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/recipe');
});

it('omits the timing line and hero image when the recipe has neither', async () => {
  mockedApi.fetchRecipe.mockResolvedValue({
    ...recipe,
    heroImagePath: null,
    activeTimeMinutes: null,
    totalTimeMinutes: null,
    yieldText: null,
  });

  await render(<RecipeDetailScreen recipeId="recipe-1" />);

  expect(screen.queryByText('Active 20 min · Total 70 min · Serves 4')).toBeNull();
  expect(screen.getByTestId('recipe-hero-placeholder')).toBeTruthy();
});
