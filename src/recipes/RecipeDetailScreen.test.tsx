import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Linking } from 'react-native';

import * as api from './api';
import * as heroImage from './heroImage';
import { RecipeDetailScreen, type RecipeDetailScreenProps } from './RecipeDetailScreen';
import { ToastProvider } from '../components/Toast';
import * as offlineRecipes from '../sync/offlineRecipes';

function renderRecipeDetailScreen(props: RecipeDetailScreenProps) {
  return render(
    <ToastProvider>
      <RecipeDetailScreen {...props} />
    </ToastProvider>,
  );
}

jest.mock('./api');
jest.mock('./heroImage');
jest.mock('../sync/offlineRecipes');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;
const mockedOfflineRecipes = offlineRecipes as jest.Mocked<typeof offlineRecipes>;
const mockedUseRouter = useRouter as jest.Mock;

const push = jest.fn();

const recipe: api.Recipe = {
  id: 'recipe-1',
  version: 1,
  title: 'Herb Roast Chicken',
  heroImagePath: 'household-1/existing.jpg',
  originalPhotoPath: null,
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
  // Defaults to "nothing synced locally yet" so existing tests exercise
  // the live-fetch fallback exactly as before; local-cache-hit tests
  // override these explicitly.
  mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(null);
  mockedOfflineRecipes.readLocalCategories.mockResolvedValue([]);
  mockedOfflineRecipes.readCachedImageUri.mockResolvedValue(null);
  // Pass-through by default — tests that only care "the hero image
  // eventually shows" don't need to know the local-vs-signed distinction.
  mockedOfflineRecipes.cacheHeroImage.mockImplementation(
    async (_heroImagePath, signedUrl) => signedUrl,
  );
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

it('shows a loading state, then the recipe', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);
  mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/existing.jpg');

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

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

  await renderRecipeDetailScreen({ recipeId: 'missing' });

  expect(screen.getByTestId('recipe-detail-load-error')).toBeTruthy();
});

it('navigates to the edit screen', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await fireEvent.press(screen.getByTestId('recipe-detail-edit-button'));

  expect(push).toHaveBeenCalledWith('/recipe/recipe-1/edit');
});

it('navigates to the history screen', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await fireEvent.press(screen.getByTestId('recipe-detail-history-button'));

  expect(push).toHaveBeenCalledWith('/recipe/recipe-1/history');
});

it('does not show an Original Photo button when the recipe has no original_photo_path', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  expect(screen.queryByTestId('recipe-detail-original-photo-button')).toBeNull();
});

it('navigates to the original photo screen, url-encoding the path, when one exists', async () => {
  mockedApi.fetchRecipe.mockResolvedValue({
    ...recipe,
    originalPhotoPath: 'household-1/originals/photo one.jpg',
  });

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await fireEvent.press(screen.getByTestId('recipe-detail-original-photo-button'));

  expect(push).toHaveBeenCalledWith(
    '/recipe/recipe-1/original-photo?path=household-1%2Foriginals%2Fphoto%20one.jpg',
  );
});

it('opens the source url in the browser', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await fireEvent.press(screen.getByTestId('recipe-detail-source-url'));

  expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/recipe');
});

it('shows the recipe from the local cache immediately, even when the live fetch is still pending', async () => {
  mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(recipe);
  mockedOfflineRecipes.readLocalCategories.mockResolvedValue([
    { id: 'cat-protein-chicken', groupName: 'protein', value: 'Chicken' },
  ]);
  mockedOfflineRecipes.readCachedImageUri.mockResolvedValue(
    'file:///cache/hero-images/existing.jpg',
  );
  // Never resolves — simulates offline; the local read alone should be
  // enough to show the recipe with no loading state or error.
  mockedApi.fetchRecipe.mockReturnValue(new Promise(() => {}));
  mockedApi.fetchCategories.mockReturnValue(new Promise(() => {}));

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.getByTestId('recipe-detail-category-Chicken')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());
  expect(screen.queryByTestId('recipe-detail-load-error')).toBeNull();
  // Cached locally — no network call needed for the hero image.
  expect(mockedHeroImage.getHeroImageUrl).not.toHaveBeenCalled();
});

it('does not show an error when the live refresh fails but local data already loaded', async () => {
  mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(recipe);
  mockedOfflineRecipes.readLocalCategories.mockResolvedValue([
    { id: 'cat-protein-chicken', groupName: 'protein', value: 'Chicken' },
  ]);
  mockedApi.fetchRecipe.mockRejectedValue(new Error('offline'));
  mockedApi.fetchCategories.mockRejectedValue(new Error('offline'));

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await waitFor(() => expect(screen.getByText('Herb Roast Chicken')).toBeTruthy());
  expect(screen.queryByTestId('recipe-detail-load-error')).toBeNull();
});

it('falls back to a live signed URL when the hero image is not cached locally', async () => {
  mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(recipe);
  mockedOfflineRecipes.readLocalCategories.mockResolvedValue([]);
  mockedOfflineRecipes.readCachedImageUri.mockResolvedValue(null);
  mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/existing.jpg');
  mockedApi.fetchRecipe.mockReturnValue(new Promise(() => {}));
  mockedApi.fetchCategories.mockReturnValue(new Promise(() => {}));

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());
  expect(mockedHeroImage.getHeroImageUrl).toHaveBeenCalledWith('household-1/existing.jpg');
});

it('caches a freshly signed-URL hero image so the next view is a cache hit', async () => {
  mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(recipe);
  mockedOfflineRecipes.readLocalCategories.mockResolvedValue([]);
  mockedOfflineRecipes.readCachedImageUri.mockResolvedValue(null);
  mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/existing.jpg');
  mockedOfflineRecipes.cacheHeroImage.mockResolvedValue('file:///cache/hero-images/existing.jpg');
  mockedApi.fetchRecipe.mockReturnValue(new Promise(() => {}));
  mockedApi.fetchCategories.mockReturnValue(new Promise(() => {}));

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());
  expect(mockedOfflineRecipes.cacheHeroImage).toHaveBeenCalledWith(
    'household-1/existing.jpg',
    'https://signed.example.com/existing.jpg',
  );
});

it('still displays the signed URL directly if caching it fails', async () => {
  mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(recipe);
  mockedOfflineRecipes.readLocalCategories.mockResolvedValue([]);
  mockedOfflineRecipes.readCachedImageUri.mockResolvedValue(null);
  mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/existing.jpg');
  mockedOfflineRecipes.cacheHeroImage.mockRejectedValue(new Error('disk full'));
  mockedApi.fetchRecipe.mockReturnValue(new Promise(() => {}));
  mockedApi.fetchCategories.mockReturnValue(new Promise(() => {}));

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());
});

it('does not attempt to cache when the hero image is already cached locally', async () => {
  mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(recipe);
  mockedOfflineRecipes.readLocalCategories.mockResolvedValue([]);
  mockedOfflineRecipes.readCachedImageUri.mockResolvedValue(
    'file:///cache/hero-images/existing.jpg',
  );
  mockedApi.fetchRecipe.mockReturnValue(new Promise(() => {}));
  mockedApi.fetchCategories.mockReturnValue(new Promise(() => {}));

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());
  expect(mockedOfflineRecipes.cacheHeroImage).not.toHaveBeenCalled();
});

it('omits the timing line and hero image when the recipe has neither', async () => {
  mockedApi.fetchRecipe.mockResolvedValue({
    ...recipe,
    heroImagePath: null,
    activeTimeMinutes: null,
    totalTimeMinutes: null,
    yieldText: null,
  });

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  expect(screen.queryByText('Active 20 min · Total 70 min · Serves 4')).toBeNull();
  expect(screen.getByTestId('recipe-hero-placeholder')).toBeTruthy();
});

it('shows a confirmation toast when reached straight from a successful import', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1', justImported: true });

  await waitFor(() => expect(screen.getByText('Recipe imported')).toBeTruthy());
});

it('shows a different toast when the import resolved to a duplicate', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1', justImported: true, wasDuplicate: true });

  await waitFor(() => expect(screen.getByText('Already in your library')).toBeTruthy());
});

it('shows no toast when navigated to normally (not from an import)', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  expect(screen.queryByText('Recipe imported')).toBeNull();
  expect(screen.queryByText('Already in your library')).toBeNull();
});
