import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useNavigation, useRouter } from 'expo-router';

import * as api from './api';
import * as heroImage from './heroImage';
import { RecipeEditorScreen } from './RecipeEditorScreen';
import { useHousehold } from '../household/HouseholdProvider';

jest.mock('./api');
jest.mock('./heroImage');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useNavigation: jest.fn() }));
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseNavigation = useNavigation as jest.Mock;
const mockedUseHousehold = useHousehold as jest.Mock;

const replace = jest.fn();
const back = jest.fn();

// The recipe Stack's state as the editor sees it. Defaults to the editor
// alone (e.g. reached by deep link); tests covering the usual path from
// the detail screen put that route beneath it.
function stackWith(...routes: { name: string; params?: { id: string } }[]) {
  return { index: routes.length - 1, routes };
}
const editRoute = { name: '[id]/edit', params: { id: 'recipe-1' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ replace, back });
  mockedUseNavigation.mockReturnValue({ getState: () => stackWith(editRoute) });
  mockedUseHousehold.mockReturnValue({ household: { id: 'household-1' } });
  mockedApi.fetchCategories.mockResolvedValue([
    { id: 'cat-protein-chicken', groupName: 'protein', value: 'Chicken' },
    { id: 'cat-dish-soup', groupName: 'dish_type', value: 'Soup' },
  ]);
  mockedApi.fetchDraft.mockResolvedValue(null);
  mockedApi.saveDraft.mockResolvedValue(undefined);
});

describe('RecipeEditorScreen — create mode', () => {
  // Explicit per-test timeouts, not jest.config.js's testTimeout (CI has
  // shown that isn't honored per-project in this multi-project setup) —
  // CI's slower/more variable runners need more headroom than the 5000ms
  // default for a render() plus several fireEvent calls, each of which is
  // async and wraps its own act() in this RNTL version.
  it('requires a title before saving', async () => {
    await render(<RecipeEditorScreen />);

    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(screen.getByTestId('recipe-editor-error')).toHaveTextContent('Title is required.');
    expect(mockedApi.saveRecipe).not.toHaveBeenCalled();
  }, 15000);

  it('saves a filled-out recipe and navigates to its detail page', async () => {
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });
    await render(<RecipeEditorScreen />);

    await fireEvent.changeText(screen.getByTestId('recipe-title-input'), '  Herb Roast Chicken  ');
    await fireEvent.changeText(
      screen.getByTestId('recipe-ingredients-line-0-0'),
      '1 whole chicken',
    );
    await fireEvent.changeText(screen.getByTestId('recipe-instructions-line-0-0'), 'Roast it.');
    await fireEvent.press(screen.getByTestId('recipe-category-cat-protein-chicken'));
    await fireEvent.changeText(screen.getByTestId('recipe-tag-input'), 'weeknight');
    await fireEvent.press(screen.getByTestId('recipe-tag-add'));

    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined,
        title: 'Herb Roast Chicken',
        categoryIds: ['cat-protein-chicken'],
        tags: ['weeknight'],
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
            ],
          },
        ],
        instructionSections: [{ title: null, lines: ['Roast it.'] }],
      }),
    );
    expect(replace).toHaveBeenCalledWith('/recipe/recipe-1');
  }, 15000);

  it('shows an error and does not navigate when saving fails', async () => {
    mockedApi.saveRecipe.mockRejectedValue(new Error('network down'));
    await render(<RecipeEditorScreen />);

    await fireEvent.changeText(screen.getByTestId('recipe-title-input'), 'Tacos');
    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(screen.getByTestId('recipe-editor-error')).toHaveTextContent(
      'Could not save this recipe. Try again.',
    );
    expect(replace).not.toHaveBeenCalled();
  }, 15000);

  it('adds and removes ingredient lines', async () => {
    await render(<RecipeEditorScreen />);

    await fireEvent.press(screen.getByTestId('recipe-ingredients-add-line-0'));
    expect(screen.getByTestId('recipe-ingredients-line-0-1')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('recipe-ingredients-remove-line-0-1'));
    expect(screen.queryByTestId('recipe-ingredients-line-0-1')).toBeNull();
  }, 15000);

  it('picks, strips, and uploads a hero photo', async () => {
    mockedHeroImage.pickHeroImage.mockResolvedValue({
      uri: 'file:///picked.jpg',
      width: 800,
      height: 800,
    });
    mockedHeroImage.stripMetadataAndResize.mockResolvedValue('file:///stripped.jpg');
    mockedHeroImage.uploadHeroImage.mockResolvedValue('household-1/abc.jpg');
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });

    await render(<RecipeEditorScreen />);

    await fireEvent.press(screen.getByTestId('recipe-hero-pick-button'));

    expect(mockedHeroImage.uploadHeroImage).toHaveBeenCalledWith(
      'household-1',
      'file:///stripped.jpg',
    );
    expect(screen.getByTestId('recipe-hero-image')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('recipe-title-input'), 'Tacos');
    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ heroImagePath: 'household-1/abc.jpg' }),
    );
  }, 15000);

  it('autosaves a debounced draft after an edit, without saving the recipe itself', async () => {
    await render(<RecipeEditorScreen />);

    await fireEvent.changeText(screen.getByTestId('recipe-title-input'), 'Weeknight Tacos');

    await waitFor(
      () =>
        expect(mockedApi.saveDraft).toHaveBeenCalledWith(
          null,
          expect.objectContaining({ title: 'Weeknight Tacos' }),
        ),
      { timeout: 5000 },
    );
    expect(mockedApi.saveRecipe).not.toHaveBeenCalled();
  }, 15000);
});

describe('RecipeEditorScreen — edit mode', () => {
  const existingRecipe: api.Recipe = {
    id: 'recipe-1',
    version: 1,
    title: 'Herb Roast Chicken',
    heroImagePath: 'household-1/existing.jpg',
    isMeal: true,
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
        ],
      },
    ],
    instructionSections: [{ title: null, lines: ['Roast it.'] }],
    archivedAt: null,
    deletedAt: null,
  };

  it('loads and preserves Turkey on an existing recipe', async () => {
    mockedApi.fetchCategories.mockResolvedValue([
      { id: 'cat-turkey', groupName: 'protein', value: 'Turkey' },
    ]);
    mockedApi.fetchRecipe.mockResolvedValue({
      ...existingRecipe,
      heroImagePath: null,
      categoryIds: ['cat-turkey'],
    });
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });
    await render(<RecipeEditorScreen recipeId="recipe-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('recipe-category-cat-turkey')).toHaveProp('accessibilityState', {
        selected: true,
      }),
    );
    await fireEvent.press(screen.getByTestId('recipe-save-button'));
    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['cat-turkey'] }),
    );
  });

  it('loads and populates the fetched recipe', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(existingRecipe);
    mockedHeroImage.getHeroImageUrl.mockResolvedValue('https://signed.example.com/existing.jpg');

    await render(<RecipeEditorScreen recipeId="recipe-1" />);

    expect(screen.getByTestId('recipe-title-input')).toHaveProp('value', 'Herb Roast Chicken');
    expect(screen.getByTestId('recipe-ingredients-line-0-0')).toHaveProp(
      'value',
      '1 whole chicken',
    );
    expect(screen.getByTestId('recipe-category-cat-protein-chicken')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );
    await waitFor(() => expect(screen.getByTestId('recipe-hero-image')).toBeTruthy());
  }, 15000);

  it('shows an error state when the recipe fails to load', async () => {
    mockedApi.fetchRecipe.mockRejectedValue(new Error('not found'));

    await render(<RecipeEditorScreen recipeId="missing" />);

    expect(screen.getByTestId('recipe-editor-load-error')).toBeTruthy();
  }, 15000);

  it('saves edits with the existing recipe id and its loaded baseVersion', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(existingRecipe);
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });

    await render(<RecipeEditorScreen recipeId="recipe-1" />);

    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recipe-1', baseVersion: 1, title: 'Herb Roast Chicken' }),
    );
    expect(replace).toHaveBeenCalledWith('/recipe/recipe-1');
  }, 15000);

  it('returns to the detail screen still inside the import flow when editing mid-import', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(existingRecipe);
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });

    await render(<RecipeEditorScreen recipeId="recipe-1" fromImport />);

    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(replace).toHaveBeenCalledWith('/recipe/recipe-1?fromImport=1');
  }, 15000);

  // #221: replacing here would stack a second detail screen on top of
  // the one Edit was pushed from.
  it("goes back to the recipe's detail screen when Edit was opened from it", async () => {
    mockedUseNavigation.mockReturnValue({
      getState: () => stackWith({ name: '[id]/index', params: { id: 'recipe-1' } }, editRoute),
    });
    mockedApi.fetchRecipe.mockResolvedValue(existingRecipe);
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });

    await render(<RecipeEditorScreen recipeId="recipe-1" fromImport />);

    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(back).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  }, 15000);

  it("replaces when the screen beneath is a different recipe's detail", async () => {
    mockedUseNavigation.mockReturnValue({
      getState: () => stackWith({ name: '[id]/index', params: { id: 'recipe-9' } }, editRoute),
    });
    mockedApi.fetchRecipe.mockResolvedValue(existingRecipe);
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });

    await render(<RecipeEditorScreen recipeId="recipe-1" />);

    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/recipe/recipe-1');
  }, 15000);

  it('prefers an existing draft over the server copy', async () => {
    mockedApi.fetchRecipe.mockResolvedValue(existingRecipe);
    mockedApi.fetchDraft.mockResolvedValue({
      title: 'Herb Roast Chicken (mid-edit)',
      tags: [],
      categoryIds: [],
      ingredientSections: [{ title: null, lines: ['1 whole chicken'] }],
      instructionSections: [{ title: null, lines: ['Roast it.'] }],
    });

    await render(<RecipeEditorScreen recipeId="recipe-1" />);

    await waitFor(() =>
      expect(screen.getByTestId('recipe-title-input')).toHaveProp(
        'value',
        'Herb Roast Chicken (mid-edit)',
      ),
    );
    expect(mockedApi.fetchDraft).toHaveBeenCalledWith('recipe-1');
  }, 15000);

  it('shows a conflict state when saving is rejected for a stale version, with a working reload', async () => {
    mockedApi.fetchRecipe.mockResolvedValueOnce(existingRecipe);
    mockedApi.saveRecipe.mockRejectedValue(new Error('recipe has changed since it was loaded'));
    mockedApi.isRecipeConflictError.mockReturnValue(true);

    await render(<RecipeEditorScreen recipeId="recipe-1" />);

    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(screen.getByTestId('recipe-editor-conflict')).toBeTruthy();
    expect(screen.getByTestId('recipe-save-button')).toHaveProp('accessibilityState', {
      disabled: true,
    });

    const reloadedRecipe = { ...existingRecipe, version: 2, title: 'Herb Roast Chicken v2' };
    mockedApi.fetchRecipe.mockResolvedValueOnce(reloadedRecipe);

    await fireEvent.press(screen.getByTestId('recipe-editor-reload-button'));

    expect(screen.queryByTestId('recipe-editor-conflict')).toBeNull();
    expect(screen.getByTestId('recipe-title-input')).toHaveProp('value', 'Herb Roast Chicken v2');

    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });
    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: 2 }));
  }, 15000);
});

describe('Meal classification', () => {
  it('defaults a new recipe to Meal and saves an explicit Non-meal choice', async () => {
    mockedApi.saveRecipe.mockResolvedValue({ id: 'cake' });
    await render(<RecipeEditorScreen />);
    expect(screen.getByTestId('recipe-type-meal')).toHaveProp('accessibilityState', {
      selected: true,
    });
    await fireEvent.changeText(screen.getByTestId('recipe-title-input'), 'Cake');
    await fireEvent.press(screen.getByTestId('recipe-type-non-meal'));
    await fireEvent.press(screen.getByTestId('recipe-save-button'));
    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ isMeal: false }));
  });

  it('loads an existing non-meal and preserves it when an old draft lacks classification', async () => {
    mockedApi.fetchRecipe.mockResolvedValue({
      id: 'cake',
      title: 'Cake',
      version: 1,
      isMeal: false,
      heroImagePath: null,
      originalPhotoPath: null,
      activeTimeMinutes: null,
      totalTimeMinutes: null,
      yieldText: null,
      servingsCount: null,
      permanentNotes: null,
      sourceUrl: null,
      sourceAttribution: null,
      tags: [],
      categoryIds: [],
      ingredientSections: [],
      instructionSections: [],
      archivedAt: null,
      deletedAt: null,
    });
    mockedApi.fetchDraft.mockResolvedValue({
      title: 'Cake draft',
      tags: [],
      categoryIds: [],
      ingredientSections: [],
      instructionSections: [],
    });
    mockedApi.saveRecipe.mockResolvedValue({ id: 'cake' });
    await render(<RecipeEditorScreen recipeId="cake" />);
    await waitFor(() =>
      expect(screen.getByTestId('recipe-title-input')).toHaveProp('value', 'Cake draft'),
    );
    expect(screen.getByTestId('recipe-type-non-meal')).toHaveProp('accessibilityState', {
      selected: true,
    });
    await fireEvent.press(screen.getByTestId('recipe-save-button'));
    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ isMeal: false }));
  });
});

it('offers Turkey when creating a recipe and saves its category assignment', async () => {
  mockedApi.fetchCategories.mockResolvedValue([
    { id: 'cat-turkey', groupName: 'protein', value: 'Turkey' },
  ]);
  mockedApi.saveRecipe.mockResolvedValue({ id: 'turkey-recipe' });
  await render(<RecipeEditorScreen />);
  await waitFor(() => expect(screen.getByTestId('recipe-category-cat-turkey')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('recipe-title-input'), 'Turkey meatballs');
  await fireEvent.press(screen.getByTestId('recipe-category-cat-turkey'));
  await fireEvent.press(screen.getByTestId('recipe-save-button'));
  expect(mockedApi.saveRecipe).toHaveBeenCalledWith(
    expect.objectContaining({ categoryIds: ['cat-turkey'] }),
  );
});

describe('Instruction step reordering', () => {
  async function typeSteps(steps: string[]) {
    for (const [i, step] of steps.entries()) {
      if (i > 0) await fireEvent.press(screen.getByTestId('recipe-instructions-add-line-0'));
      await fireEvent.changeText(screen.getByTestId(`recipe-instructions-line-0-${i}`), step);
    }
  }

  function stepValues(sectionIndex: number, count: number) {
    return Array.from(
      { length: count },
      (_, i) => screen.getByTestId(`recipe-instructions-line-${sectionIndex}-${i}`).props.value,
    );
  }

  it('moves steps up and down when creating a recipe, and saves the new order', async () => {
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });
    await render(<RecipeEditorScreen />);
    await fireEvent.changeText(screen.getByTestId('recipe-title-input'), 'Soup');
    await typeSteps(['Chop', 'Simmer', 'Serve']);

    await fireEvent.press(screen.getByTestId('recipe-instructions-move-up-0-2'));
    expect(stepValues(0, 3)).toEqual(['Chop', 'Serve', 'Simmer']);
    await fireEvent.press(screen.getByTestId('recipe-instructions-move-down-0-0'));
    expect(stepValues(0, 3)).toEqual(['Serve', 'Chop', 'Simmer']);

    await fireEvent.press(screen.getByTestId('recipe-save-button'));
    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        instructionSections: [{ title: null, lines: ['Serve', 'Chop', 'Simmer'] }],
      }),
    );
  }, 15000);

  it('keeps each row attached to its own step across a move', async () => {
    await render(<RecipeEditorScreen />);
    await typeSteps(['Chop', 'Simmer']);
    const chopRow = screen.getByTestId('recipe-instructions-line-0-0');

    await fireEvent.press(screen.getByTestId('recipe-instructions-move-down-0-0'));

    // Same host input, now in second position: a focused input (and the
    // keyboard on it) travels with its step instead of staying in slot 0.
    expect(screen.getByTestId('recipe-instructions-line-0-1')).toBe(chopRow);
  }, 15000);

  it('disables moves past a section boundary and hides them for a single step', async () => {
    await render(<RecipeEditorScreen />);

    expect(screen.queryByTestId('recipe-instructions-move-up-0-0')).toBeNull();
    expect(screen.queryByTestId('recipe-instructions-move-down-0-0')).toBeNull();

    await typeSteps(['Chop', 'Simmer']);
    expect(screen.getByTestId('recipe-instructions-move-up-0-0')).toBeDisabled();
    expect(screen.getByTestId('recipe-instructions-move-down-0-1')).toBeDisabled();
    expect(screen.getByLabelText('Move step 1 down')).toBeEnabled();
    expect(screen.getByLabelText('Move step 2 up')).toBeEnabled();
  }, 15000);

  it('does not offer reordering for ingredients', async () => {
    await render(<RecipeEditorScreen />);
    await fireEvent.press(screen.getByTestId('recipe-ingredients-add-line-0'));

    expect(screen.queryByTestId('recipe-ingredients-move-up-0-1')).toBeNull();
  }, 15000);

  it('reorders within one section of an existing recipe without touching the others', async () => {
    mockedApi.fetchRecipe.mockResolvedValue({
      id: 'recipe-1',
      version: 3,
      title: 'Pie',
      heroImagePath: null,
      isMeal: false,
      originalPhotoPath: null,
      activeTimeMinutes: null,
      totalTimeMinutes: null,
      yieldText: null,
      servingsCount: null,
      permanentNotes: null,
      sourceUrl: null,
      sourceAttribution: null,
      tags: [],
      categoryIds: [],
      ingredientSections: [],
      instructionSections: [
        { title: 'Crust', lines: ['Mix', 'Chill'] },
        { title: 'Filling', lines: ['Slice', 'Toss', 'Fill'] },
      ],
      archivedAt: null,
      deletedAt: null,
    });
    mockedApi.saveRecipe.mockResolvedValue({ id: 'recipe-1' });
    await render(<RecipeEditorScreen recipeId="recipe-1" />);

    // Last step of a section can't move into the next one.
    expect(screen.getByTestId('recipe-instructions-move-down-0-1')).toBeDisabled();
    expect(screen.getByTestId('recipe-instructions-move-up-1-0')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('recipe-instructions-move-up-1-2'));
    await fireEvent.press(screen.getByTestId('recipe-save-button'));

    expect(mockedApi.saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'recipe-1',
        baseVersion: 3,
        instructionSections: [
          { title: 'Crust', lines: ['Mix', 'Chill'] },
          { title: 'Filling', lines: ['Slice', 'Fill', 'Toss'] },
        ],
      }),
    );
  }, 15000);
});
