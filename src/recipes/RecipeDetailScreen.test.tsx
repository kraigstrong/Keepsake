import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ActionSheetIOS, Linking } from 'react-native';

import * as api from './api';
import * as heroImage from './heroImage';
import { RecipeDetailScreen, type RecipeDetailScreenProps } from './RecipeDetailScreen';
import { confirm } from '../components/confirm';
import { ToastProvider } from '../components/Toast';
import * as cookingApi from '../cooking/api';
import * as householdApi from '../household/api';
import { useHousehold } from '../household/HouseholdProvider';
import { useSession } from '../session/SessionProvider';
import * as offlineRecipes from '../sync/offlineRecipes';
import * as thisWeekApi from '../thisWeek/api';

function renderRecipeDetailScreen(props: RecipeDetailScreenProps) {
  return render(
    <ToastProvider>
      <RecipeDetailScreen {...props} />
    </ToastProvider>,
  );
}

jest.mock('./api');
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('./heroImage');
jest.mock('../components/confirm');
// formatCookedAt stays real (jest.requireActual) — this suite asserts
// on its actual formatted output ("Aug 10, 2026"), only getCookingHistory
// itself needs mocking.
jest.mock('../cooking/api', () => ({
  ...jest.requireActual('../cooking/api'),
  getCookingHistory: jest.fn(),
}));
jest.mock('../household/api');
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
jest.mock('../session/SessionProvider', () => ({ useSession: jest.fn() }));
jest.mock('../sync/offlineRecipes');
jest.mock('../thisWeek/api');
// Real useFocusEffect only re-invokes its callback on a focus event, or
// when the memoized callback's identity changes while still focused —
// never on every unrelated re-render. This mock approximates that by
// only calling a *new* callback identity, same pattern
// ThisWeekScreen.test.tsx uses for its own useFocusEffect usage.
let mockLastFocusEffect: (() => void) | null = null;
// Stack.Screen renders its headerRight inline, so the header's More
// button is pressable like any other element in the tree.
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => import('react').ReactNode } }) =>
      options?.headerRight?.() ?? null,
  },
  useRouter: jest.fn(),
  useNavigation: () => ({ getParent: () => ({ goBack: mockParentGoBack }) }),
  useFocusEffect: jest.fn((effect: () => void) => {
    if (effect !== mockLastFocusEffect) {
      mockLastFocusEffect = effect;
      effect();
    }
  }),
}));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;
const mockedCookingApi = cookingApi as jest.Mocked<typeof cookingApi>;
const mockedHouseholdApi = householdApi as jest.Mocked<typeof householdApi>;
const mockedUseHousehold = useHousehold as jest.Mock;
const mockedUseSession = useSession as jest.Mock;
const mockedOfflineRecipes = offlineRecipes as jest.Mocked<typeof offlineRecipes>;
const mockedThisWeekApi = thisWeekApi as jest.Mocked<typeof thisWeekApi>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedConfirm = confirm as jest.Mock;
let mockedShowActionSheet: jest.SpyInstance<
  void,
  Parameters<typeof ActionSheetIOS.showActionSheetWithOptions>
>;

// Opens the More menu and returns the labels it offered, in order.
async function openMoreMenu(): Promise<string[]> {
  await fireEvent.press(screen.getByTestId('recipe-detail-more-button'));
  const [options] = mockedShowActionSheet.mock.calls.at(-1)!;
  return options.options;
}

async function chooseMoreMenuAction(label: string) {
  const labels = await openMoreMenu();
  const index = labels.indexOf(label);
  if (index === -1) throw new Error(`More menu has no "${label}": ${labels.join(', ')}`);
  const [, callback] = mockedShowActionSheet.mock.calls.at(-1)!;
  await act(async () => callback(index));
}

const push = jest.fn();
const back = jest.fn();
const mockParentGoBack = jest.fn();

const recipe: api.Recipe = {
  id: 'recipe-1',
  version: 1,
  title: 'Herb Roast Chicken',
  heroImagePath: 'household-1/existing.jpg',
  originalPhotoPath: null,
  activeTimeMinutes: 20,
  totalTimeMinutes: 70,
  yieldText: 'Serves 4',
  servingsCount: 4,
  permanentNotes: 'Great with potatoes.',
  sourceUrl: 'https://example.com/recipe',
  sourceAttribution: 'Grandma',
  tags: ['weeknight'],
  categoryIds: ['cat-protein-chicken'],
  ingredientSections: [
    {
      title: null,
      lines: [
        {
          lineText: '1 whole chicken',
          quantityMin: 1,
          quantityMax: 1,
          unit: null,
          ingredientText: 'whole chicken',
        },
        {
          lineText: '2 tbsp butter',
          quantityMin: 2,
          quantityMax: 2,
          unit: 'tbsp',
          ingredientText: 'butter',
        },
      ],
    },
  ],
  instructionSections: [{ title: null, lines: ['Preheat the oven.', 'Roast it.'] }],
  archivedAt: null,
  deletedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ push, back });
  mockedUseHousehold.mockReturnValue({ household: { id: 'h1' } });
  mockedUseSession.mockReturnValue({ session: { user: { id: 'user-1' } } });
  mockedHouseholdApi.fetchProfile.mockResolvedValue({
    id: 'user-1',
    displayName: 'Alice',
    preferredUnitSystem: 'us_customary',
  });
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
  mockedThisWeekApi.fetchCurrentWeeklyPlan.mockResolvedValue({
    id: 'plan-1',
    status: 'planning',
    entries: [],
  });
  mockedThisWeekApi.addRecipeToThisWeek.mockResolvedValue(undefined);
  mockedCookingApi.getCookingHistory.mockResolvedValue([]);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  mockedShowActionSheet = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation(() => undefined);
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

  await chooseMoreMenuAction('Edit');

  expect(push).toHaveBeenCalledWith('/recipe/recipe-1/edit');
});

it('navigates to the history screen when more than one version exists', async () => {
  mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, version: 2 });

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await chooseMoreMenuAction('History');

  expect(push).toHaveBeenCalledWith('/recipe/recipe-1/history');
});

it('leaves History out of the More menu when the recipe has only one version', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  expect(await openMoreMenu()).not.toContain('History');
});

it('leaves Original Photo out of the More menu when the recipe has no original_photo_path', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  expect(await openMoreMenu()).not.toContain('Original Photo');
});

it('navigates to the original photo screen, url-encoding the path, when one exists', async () => {
  mockedApi.fetchRecipe.mockResolvedValue({
    ...recipe,
    originalPhotoPath: 'household-1/originals/photo one.jpg',
  });

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  await chooseMoreMenuAction('Original Photo');

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

it('offers a Done action after an import that returns to the originating tab', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1', justImported: true });

  await fireEvent.press(screen.getByTestId('recipe-detail-import-done'));

  // Pops the whole recipe stack, not just this screen — back() alone
  // would land on the earlier detail screen after an Edit → Save.
  expect(mockParentGoBack).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
});

it('keeps the Done action, without the toast, when returning from an edit mid-import', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1', fromImport: true });

  expect(screen.getByTestId('recipe-detail-import-done')).toBeTruthy();
  expect(screen.queryByText('Recipe imported')).toBeNull();
});

it('shows no Done action when navigated to normally', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

  expect(screen.queryByTestId('recipe-detail-import-done')).toBeNull();
});

it('carries the import context into the editor', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1', justImported: true });

  await chooseMoreMenuAction('Edit');

  expect(push).toHaveBeenCalledWith('/recipe/recipe-1/edit?fromImport=1');
});

it('adds the recipe to This Week at the currently selected multiplier', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
  await fireEvent.press(screen.getByTestId('recipe-detail-add-to-this-week'));

  await waitFor(() => expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalled());
  expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalledWith('plan-1', 'recipe-1', 1);
  expect(screen.getByText('Added to This Week')).toBeTruthy();
});

it('adds at the multiplier implied by the stepper after adjusting it', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
  await fireEvent.press(screen.getByTestId('recipe-servings-increment'));
  await fireEvent.press(screen.getByTestId('recipe-detail-add-to-this-week'));

  await waitFor(() => expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalled());
  // recipe.servingsCount is 4; incrementing once moves 4 -> 5 servings,
  // i.e. a 1.25x multiplier.
  expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalledWith('plan-1', 'recipe-1', 1.25);
});

// ADR-0026: addRecipeToThisWeek now takes the screen's own multiplier
// directly, not a serving count derived (with a fallback base) from
// recipe.servingsCount. A recipe with no parsed servings count still
// adds correctly at whatever multiplier is selected — there's no
// absolute count to fall back to or drop.
it('adds at multiplier 1 by default even when the recipe has no parsed servings count', async () => {
  mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, servingsCount: null, yieldText: '1 loaf' });

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
  await fireEvent.press(screen.getByTestId('recipe-detail-add-to-this-week'));

  await waitFor(() => expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalled());
  expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalledWith('plan-1', 'recipe-1', 1);
});

it('adds at the selected preset multiplier when the recipe has no parsed servings count (developer walkthrough feedback)', async () => {
  mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, servingsCount: null, yieldText: '1 loaf' });

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
  // No stepper renders for this recipe (no parsed base count), but the
  // scale presets still do — this is exactly the path that used to
  // silently drop the multiplier.
  expect(screen.queryByTestId('recipe-servings-stepper')).toBeNull();
  await fireEvent.press(screen.getByTestId('recipe-scale-preset-2'));
  await fireEvent.press(screen.getByTestId('recipe-detail-add-to-this-week'));

  await waitFor(() => expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalled());
  expect(mockedThisWeekApi.addRecipeToThisWeek).toHaveBeenCalledWith('plan-1', 'recipe-1', 2);
});

it('shows an error toast when adding to This Week fails', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);
  mockedThisWeekApi.fetchCurrentWeeklyPlan.mockRejectedValue(new Error('offline'));

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
  await fireEvent.press(screen.getByTestId('recipe-detail-add-to-this-week'));

  await waitFor(() => expect(screen.getByText("Couldn't add to This Week")).toBeTruthy());
});

it('shows a locked-plan-specific toast when the current week is confirmed', async () => {
  mockedApi.fetchRecipe.mockResolvedValue(recipe);
  mockedThisWeekApi.fetchCurrentWeeklyPlan.mockResolvedValue({
    id: 'plan-1',
    status: 'confirmed',
    entries: [],
  });
  mockedThisWeekApi.addRecipeToThisWeek.mockRejectedValue(
    new Error('weekly plan is not in planning state'),
  );

  await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
  await fireEvent.press(screen.getByTestId('recipe-detail-add-to-this-week'));

  await waitFor(() =>
    expect(screen.getByText("This week's plan is locked — reopen it to add recipes")).toBeTruthy(),
  );
});

// #221: the editor and history restore return here with router.back(),
// to this same still-mounted instance.
describe('refreshing on refocus', () => {
  beforeEach(() => {
    mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/existing.jpg');
  });

  async function refocus() {
    await act(async () => mockLastFocusEffect?.());
  }

  it('does not refetch the recipe on the first focus', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    expect(mockedApi.fetchRecipe).toHaveBeenCalledTimes(1);
  });

  it('shows the saved changes when refocused, without the loading state', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();

    let resolveRefresh: (value: api.Recipe) => void = () => {};
    mockedApi.fetchRecipe.mockReturnValue(new Promise((resolve) => (resolveRefresh = resolve)));
    await refocus();
    expect(screen.queryByTestId('recipe-detail-loading')).toBeNull();
    expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();

    await act(async () => resolveRefresh({ ...recipe, title: 'Lemon Roast Chicken' }));
    expect(screen.getByText('Lemon Roast Chicken')).toBeTruthy();
  });

  it('does not reload an unchanged hero image', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());
    const heroLoads = mockedOfflineRecipes.readCachedImageUri.mock.calls.length;

    mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, title: 'Lemon Roast Chicken' });
    await refocus();

    expect(screen.getByText('Lemon Roast Chicken')).toBeTruthy();
    expect(mockedOfflineRecipes.readCachedImageUri).toHaveBeenCalledTimes(heroLoads);
    expect(screen.getByTestId('recipe-hero')).toHaveProp('source', {
      uri: 'https://signed.example.com/existing.jpg',
    });
  });

  it('loads a changed hero image', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedHeroImage.getHeroImageUrl.mockImplementation(
      async (path) => `https://signed.example.com/${path}`,
    );
    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());

    mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, heroImagePath: 'household-1/new.jpg' });
    await refocus();

    await waitFor(() =>
      expect(screen.getByTestId('recipe-hero')).toHaveProp('source', {
        uri: 'https://signed.example.com/household-1/new.jpg',
      }),
    );
  });

  it('drops the hero image when the edit removed it', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await waitFor(() => expect(screen.getByTestId('recipe-hero')).toBeTruthy());

    mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, heroImagePath: null });
    await refocus();

    expect(screen.queryByTestId('recipe-hero')).toBeNull();
  });

  it('does not let a slower initial fetch overwrite the refreshed recipe', async () => {
    mockedOfflineRecipes.readLocalRecipe.mockResolvedValue(recipe);
    let resolveInitial: (value: api.Recipe) => void = () => {};
    mockedApi.fetchRecipe.mockReturnValueOnce(new Promise((resolve) => (resolveInitial = resolve)));
    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, title: 'Lemon Roast Chicken' });
    await refocus();
    expect(screen.getByText('Lemon Roast Chicken')).toBeTruthy();

    await act(async () => resolveInitial(recipe));
    expect(screen.getByText('Lemon Roast Chicken')).toBeTruthy();
  });

  it('does not let a slower initial hero load bring back a removed image', async () => {
    let resolveInitialHero: (value: string) => void = () => {};
    mockedHeroImage.getHeroImageUrl.mockReturnValueOnce(
      new Promise((resolve) => (resolveInitialHero = resolve)),
    );
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    mockedApi.fetchRecipe.mockResolvedValue({ ...recipe, heroImagePath: null });
    await refocus();

    await act(async () => resolveInitialHero('https://signed.example.com/existing.jpg'));
    expect(screen.queryByTestId('recipe-hero')).toBeNull();
  });

  it('keeps showing the recipe when the refresh fails', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    mockedApi.fetchRecipe.mockRejectedValue(new Error('offline'));
    await refocus();

    expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();
    expect(screen.queryByTestId('recipe-detail-load-error')).toBeNull();
  });
});

describe('cooking history (Phase 15, REC-05/NOTE-01..03)', () => {
  it('does not show a Cooking History section when there is none yet', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedCookingApi.getCookingHistory.mockResolvedValue([]);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await waitFor(() =>
      expect(mockedCookingApi.getCookingHistory).toHaveBeenCalledWith('recipe-1'),
    );

    expect(screen.queryByTestId('recipe-detail-cooking-history')).toBeNull();
  });

  it('shows cooking events newest-first, with their notes, once loaded', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedCookingApi.getCookingHistory.mockResolvedValue([
      {
        id: 'event-2',
        recipeId: 'recipe-1',
        cookedAt: '2026-08-10T18:00:00.000Z',
        note: 'Kids loved this.',
      },
      { id: 'event-1', recipeId: 'recipe-1', cookedAt: '2026-08-01T18:00:00.000Z', note: null },
    ]);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    await waitFor(() => expect(screen.getByTestId('recipe-detail-cooking-history')).toBeTruthy());
    expect(screen.getByText('Kids loved this.')).toBeTruthy();
    expect(screen.getByText('Aug 10, 2026')).toBeTruthy();
    expect(screen.getByText('Aug 1, 2026')).toBeTruthy();
  });

  it('does not show a Cooking History section when the load fails', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedCookingApi.getCookingHistory.mockRejectedValue(new Error('offline'));

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await waitFor(() => expect(mockedCookingApi.getCookingHistory).toHaveBeenCalled());

    expect(screen.queryByTestId('recipe-detail-cooking-history')).toBeNull();
  });
});

describe('More menu (#226)', () => {
  it('offers Edit, Archive and Delete for a single-version recipe with no photo, then Cancel', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    expect(await openMoreMenu()).toEqual(['Edit', 'Archive', 'Delete', 'Cancel']);
  });

  it('offers every action in order, with Delete marked destructive', async () => {
    mockedApi.fetchRecipe.mockResolvedValue({
      ...recipe,
      version: 3,
      originalPhotoPath: 'household-1/originals/photo.jpg',
    });

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    expect(await openMoreMenu()).toEqual([
      'Edit',
      'History',
      'Original Photo',
      'Archive',
      'Delete',
      'Cancel',
    ]);
    const [options] = mockedShowActionSheet.mock.calls.at(-1)!;
    expect(options.destructiveButtonIndex).toBe(4);
    expect(options.cancelButtonIndex).toBe(5);
  });

  it('does nothing when the menu is cancelled', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await chooseMoreMenuAction('Cancel');

    expect(mockedApi.archiveRecipe).not.toHaveBeenCalled();
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('archive/delete (Phase 16, ADR-0025)', () => {
  it('archives the recipe and offers Unarchive afterwards', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedApi.archiveRecipe.mockResolvedValue(undefined);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await chooseMoreMenuAction('Archive');

    await waitFor(() => expect(mockedApi.archiveRecipe).toHaveBeenCalledWith('recipe-1'));
    expect(screen.getByText('Recipe archived')).toBeTruthy();
    expect(await openMoreMenu()).toContain('Unarchive');
  });

  it('unarchives an already-archived recipe and offers Archive afterwards', async () => {
    mockedApi.fetchRecipe.mockResolvedValue({
      ...recipe,
      archivedAt: '2026-08-10T00:00:00.000Z',
    });
    mockedApi.unarchiveRecipe.mockResolvedValue(undefined);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await chooseMoreMenuAction('Unarchive');

    await waitFor(() => expect(mockedApi.unarchiveRecipe).toHaveBeenCalledWith('recipe-1'));
    expect(screen.getByText('Recipe unarchived')).toBeTruthy();
    expect(await openMoreMenu()).toContain('Archive');
  });

  it('shows an error toast when archiving fails, and still offers Archive', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedApi.archiveRecipe.mockRejectedValue(new Error('offline'));

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await chooseMoreMenuAction('Archive');

    await waitFor(() => expect(screen.getByText("Couldn't archive recipe")).toBeTruthy());
    expect(await openMoreMenu()).toContain('Archive');
  });

  it('does nothing when Delete is pressed and the confirmation is declined', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedConfirm.mockResolvedValue(false);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await chooseMoreMenuAction('Delete');

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalled());
    expect(mockedApi.deleteRecipe).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it('deletes the recipe and navigates back after confirming', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedConfirm.mockResolvedValue(true);
    mockedApi.deleteRecipe.mockResolvedValue(undefined);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await chooseMoreMenuAction('Delete');

    await waitFor(() => expect(mockedApi.deleteRecipe).toHaveBeenCalledWith('recipe-1'));
    expect(back).toHaveBeenCalled();
  });

  it('shows an error toast and stays on the screen when delete fails after confirming', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedConfirm.mockResolvedValue(true);
    mockedApi.deleteRecipe.mockRejectedValue(new Error('offline'));

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    await chooseMoreMenuAction('Delete');

    await waitFor(() => expect(screen.getByText("Couldn't delete recipe")).toBeTruthy());
    expect(back).not.toHaveBeenCalled();
  });

  it('hides Add to This Week for an archived recipe (LIFE-01)', async () => {
    mockedApi.fetchRecipe.mockResolvedValue({
      ...recipe,
      archivedAt: '2026-08-10T00:00:00.000Z',
    });

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });

    expect(screen.queryByTestId('recipe-detail-add-to-this-week')).toBeNull();
  });

  it('hides Add to This Week immediately after archiving, without a reload', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(recipe);
    mockedApi.archiveRecipe.mockResolvedValue(undefined);

    await renderRecipeDetailScreen({ recipeId: 'recipe-1' });
    expect(screen.getByTestId('recipe-detail-add-to-this-week')).toBeTruthy();

    await chooseMoreMenuAction('Archive');

    await waitFor(() => expect(screen.queryByTestId('recipe-detail-add-to-this-week')).toBeNull());
  });
});
