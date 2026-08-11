import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import * as api from './api';
import * as heroImage from './heroImage';
import { RecipeEditorScreen } from './RecipeEditorScreen';
import { useHousehold } from '../household/HouseholdProvider';

jest.mock('./api');
jest.mock('./heroImage');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../household/HouseholdProvider', () => ({ useHousehold: jest.fn() }));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedHeroImage = heroImage as jest.Mocked<typeof heroImage>;
const mockedUseRouter = useRouter as jest.Mock;
const mockedUseHousehold = useHousehold as jest.Mock;

const replace = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseRouter.mockReturnValue({ replace });
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
