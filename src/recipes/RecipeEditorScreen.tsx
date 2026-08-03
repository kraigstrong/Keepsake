import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  type Category,
  type CategoryGroup,
  fetchCategories,
  fetchRecipe,
  type RecipeSavePayload,
  type RecipeSection,
  saveRecipe,
} from './api';
import {
  getHeroImageUrl,
  pickHeroImage,
  stripMetadataAndResize,
  uploadHeroImage,
} from './heroImage';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ErrorState } from '../components/ErrorState';
import { ImagePlaceholder } from '../components/ImagePlaceholder';
import { LoadingState } from '../components/LoadingState';
import { useHousehold } from '../household/HouseholdProvider';
import { colors, radii, spacing, typography } from '../theme/tokens';

export interface RecipeEditorScreenProps {
  recipeId?: string;
}

const GROUP_LABELS: Record<CategoryGroup, string> = {
  protein: 'Protein',
  dish_type: 'Dish Type',
  preparation: 'Preparation',
};

const EMPTY_SECTIONS: RecipeSection[] = [{ title: null, lines: [''] }];

/**
 * Single screen for both create (no recipeId) and edit (recipeId set) —
 * ADR-0010's "wipe and reinsert children" save shape means there's no
 * meaningful difference between the two beyond whether an existing
 * recipe is loaded first, so one form covers both rather than forking
 * into separate screens.
 */
export function RecipeEditorScreen({ recipeId }: RecipeEditorScreenProps) {
  const router = useRouter();
  const { household } = useHousehold();

  const [isLoading, setIsLoading] = useState(recipeId != null);
  const [loadError, setLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState('');
  const [heroImagePath, setHeroImagePath] = useState<string | null>(null);
  const [heroPreviewUri, setHeroPreviewUri] = useState<string | null>(null);
  const [activeTimeMinutes, setActiveTimeMinutes] = useState('');
  const [totalTimeMinutes, setTotalTimeMinutes] = useState('');
  const [yieldText, setYieldText] = useState('');
  const [permanentNotes, setPermanentNotes] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceAttribution, setSourceAttribution] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [ingredientSections, setIngredientSections] = useState<RecipeSection[]>(EMPTY_SECTIONS);
  const [instructionSections, setInstructionSections] = useState<RecipeSection[]>(EMPTY_SECTIONS);

  useEffect(() => {
    let cancelled = false;

    fetchCategories()
      .then((fetched) => {
        if (!cancelled) setCategories(fetched);
      })
      .catch(() => {
        // Categories are supplementary filtering — a fetch failure here
        // shouldn't block the rest of the form from loading/working.
      });

    if (recipeId) {
      fetchRecipe(recipeId)
        .then((recipe) => {
          if (cancelled) return;
          setTitle(recipe.title);
          setHeroImagePath(recipe.heroImagePath);
          setActiveTimeMinutes(recipe.activeTimeMinutes?.toString() ?? '');
          setTotalTimeMinutes(recipe.totalTimeMinutes?.toString() ?? '');
          setYieldText(recipe.yieldText ?? '');
          setPermanentNotes(recipe.permanentNotes ?? '');
          setSourceUrl(recipe.sourceUrl ?? '');
          setSourceAttribution(recipe.sourceAttribution ?? '');
          setTags(recipe.tags);
          setCategoryIds(recipe.categoryIds);
          setIngredientSections(
            recipe.ingredientSections.length > 0 ? recipe.ingredientSections : EMPTY_SECTIONS,
          );
          setInstructionSections(
            recipe.instructionSections.length > 0 ? recipe.instructionSections : EMPTY_SECTIONS,
          );
          setIsLoading(false);

          if (recipe.heroImagePath) {
            getHeroImageUrl(recipe.heroImagePath).then((url) => {
              if (!cancelled && url) setHeroPreviewUri(url);
            });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLoadError(true);
            setIsLoading(false);
          }
        });
    }

    return () => {
      cancelled = true;
    };
    // Deliberately runs once per recipeId — re-running on every render
    // would clobber in-progress edits with the server copy.
  }, [recipeId]);

  async function handlePickImage() {
    const picked = await pickHeroImage();
    if (!picked || !household) return;

    setIsUploadingImage(true);
    setSaveError(null);
    try {
      const strippedUri = await stripMetadataAndResize(picked.uri);
      const path = await uploadHeroImage(household.id, strippedUri);
      setHeroImagePath(path);
      setHeroPreviewUri(strippedUri);
    } catch {
      setSaveError('Could not upload that photo. Try again.');
    } finally {
      setIsUploadingImage(false);
    }
  }

  function handleRemoveImage() {
    setHeroImagePath(null);
    setHeroPreviewUri(null);
  }

  function handleAddTag() {
    const trimmed = tagDraft.trim();
    if (trimmed.length === 0 || tags.includes(trimmed)) {
      setTagDraft('');
      return;
    }
    setTags([...tags, trimmed]);
    setTagDraft('');
  }

  function handleRemoveTag(tag: string) {
    setTags(tags.filter((existing) => existing !== tag));
  }

  function toggleCategory(id: string) {
    setCategoryIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }

  async function handleSave() {
    setSaveError(null);
    if (title.trim().length === 0) {
      setSaveError('Title is required.');
      return;
    }

    setIsSaving(true);
    try {
      const payload: RecipeSavePayload = {
        id: recipeId,
        title: title.trim(),
        heroImagePath,
        activeTimeMinutes: parseMinutes(activeTimeMinutes),
        totalTimeMinutes: parseMinutes(totalTimeMinutes),
        yieldText: yieldText.trim() || null,
        permanentNotes: permanentNotes.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        sourceAttribution: sourceAttribution.trim() || null,
        tags,
        categoryIds,
        ingredientSections: cleanSections(ingredientSections),
        instructionSections: cleanSections(instructionSections),
      };
      const { id } = await saveRecipe(payload);
      router.replace(`/recipe/${id}`);
    } catch {
      setSaveError('Could not save this recipe. Try again.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <LoadingState label="Loading recipe…" testID="recipe-editor-loading" />;
  }

  if (loadError) {
    return (
      <ErrorState
        title="Couldn't load this recipe"
        message="Check your connection and try again."
        testID="recipe-editor-load-error"
      />
    );
  }

  const groupedCategories = groupCategories(categories);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="recipe-editor-screen"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>Photo</Text>
      <View style={styles.heroRow}>
        <Pressable
          testID="recipe-hero-image-picker"
          accessibilityRole="button"
          accessibilityLabel="Add photo"
          onPress={handlePickImage}
        >
          {heroPreviewUri ? (
            <Image
              source={{ uri: heroPreviewUri }}
              style={styles.heroImage}
              testID="recipe-hero-image"
            />
          ) : (
            <ImagePlaceholder size={96} testID="recipe-hero-placeholder" />
          )}
        </Pressable>
        <View style={styles.heroActions}>
          <Button
            title={isUploadingImage ? 'Uploading…' : heroImagePath ? 'Change photo' : 'Add photo'}
            variant="secondary"
            onPress={handlePickImage}
            disabled={isUploadingImage}
            testID="recipe-hero-pick-button"
          />
          {heroImagePath && (
            <Button
              title="Remove"
              variant="secondary"
              onPress={handleRemoveImage}
              testID="recipe-hero-remove-button"
            />
          )}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Title</Text>
      <TextInput
        testID="recipe-title-input"
        style={styles.input}
        placeholder="Recipe title"
        placeholderTextColor={colors.textTertiary}
        value={title}
        onChangeText={setTitle}
      />

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.sectionLabel}>Active time (min)</Text>
          <TextInput
            testID="recipe-active-time-input"
            style={styles.input}
            placeholder="20"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            value={activeTimeMinutes}
            onChangeText={setActiveTimeMinutes}
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.sectionLabel}>Total time (min)</Text>
          <TextInput
            testID="recipe-total-time-input"
            style={styles.input}
            placeholder="60"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
            value={totalTimeMinutes}
            onChangeText={setTotalTimeMinutes}
          />
        </View>
      </View>

      <Text style={styles.sectionLabel}>Yield</Text>
      <TextInput
        testID="recipe-yield-input"
        style={styles.input}
        placeholder="Serves 4"
        placeholderTextColor={colors.textTertiary}
        value={yieldText}
        onChangeText={setYieldText}
      />

      <Text style={styles.sectionLabel}>Ingredients</Text>
      <SectionsEditor
        sections={ingredientSections}
        onChange={setIngredientSections}
        linePlaceholder="1 cup flour"
        addLineLabel="Add ingredient"
        addSectionLabel="Add section"
        testIDPrefix="recipe-ingredients"
      />

      <Text style={styles.sectionLabel}>Instructions</Text>
      <SectionsEditor
        sections={instructionSections}
        onChange={setInstructionSections}
        linePlaceholder="Preheat the oven…"
        addLineLabel="Add step"
        addSectionLabel="Add section"
        testIDPrefix="recipe-instructions"
      />

      {groupedCategories.map(([group, values]) => (
        <View key={group}>
          <Text style={styles.sectionLabel}>{GROUP_LABELS[group]}</Text>
          <View style={styles.chipRow}>
            {values.map((category) => (
              <Chip
                key={category.id}
                label={category.value}
                selected={categoryIds.includes(category.id)}
                onPress={() => toggleCategory(category.id)}
                testID={`recipe-category-${category.id}`}
              />
            ))}
          </View>
        </View>
      ))}

      <Text style={styles.sectionLabel}>Tags</Text>
      <View style={styles.chipRow}>
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            selected
            onPress={() => handleRemoveTag(tag)}
            testID={`recipe-tag-${tag}`}
          />
        ))}
      </View>
      <View style={styles.tagInputRow}>
        <TextInput
          testID="recipe-tag-input"
          style={[styles.input, styles.tagInput]}
          placeholder="Add a tag"
          placeholderTextColor={colors.textTertiary}
          value={tagDraft}
          onChangeText={setTagDraft}
          onSubmitEditing={handleAddTag}
        />
        <Button title="Add" variant="secondary" onPress={handleAddTag} testID="recipe-tag-add" />
      </View>

      <Text style={styles.sectionLabel}>Notes</Text>
      <TextInput
        testID="recipe-notes-input"
        style={[styles.input, styles.multiline]}
        placeholder="Anything worth remembering next time"
        placeholderTextColor={colors.textTertiary}
        value={permanentNotes}
        onChangeText={setPermanentNotes}
        multiline
      />

      <Text style={styles.sectionLabel}>Source URL</Text>
      <TextInput
        testID="recipe-source-url-input"
        style={styles.input}
        placeholder="https://…"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={sourceUrl}
        onChangeText={setSourceUrl}
      />

      <Text style={styles.sectionLabel}>Source attribution</Text>
      <TextInput
        testID="recipe-source-attribution-input"
        style={styles.input}
        placeholder="e.g. a cookbook or a person's name"
        placeholderTextColor={colors.textTertiary}
        value={sourceAttribution}
        onChangeText={setSourceAttribution}
      />

      {saveError && (
        <Text style={styles.error} testID="recipe-editor-error" accessibilityRole="alert">
          {saveError}
        </Text>
      )}

      <Button
        title={isSaving ? 'Saving…' : 'Save'}
        onPress={handleSave}
        disabled={isSaving}
        testID="recipe-save-button"
      />
    </ScrollView>
  );
}

function SectionsEditor({
  sections,
  onChange,
  linePlaceholder,
  addLineLabel,
  addSectionLabel,
  testIDPrefix,
}: {
  sections: RecipeSection[];
  onChange: (sections: RecipeSection[]) => void;
  linePlaceholder: string;
  addLineLabel: string;
  addSectionLabel: string;
  testIDPrefix: string;
}) {
  function updateSectionTitle(sectionIndex: number, value: string) {
    onChange(
      sections.map((section, index) =>
        index === sectionIndex ? { ...section, title: value } : section,
      ),
    );
  }

  function updateLine(sectionIndex: number, lineIndex: number, value: string) {
    onChange(
      sections.map((section, index) => {
        if (index !== sectionIndex) return section;
        return {
          ...section,
          lines: section.lines.map((line, li) => (li === lineIndex ? value : line)),
        };
      }),
    );
  }

  function addLine(sectionIndex: number) {
    onChange(
      sections.map((section, index) =>
        index === sectionIndex ? { ...section, lines: [...section.lines, ''] } : section,
      ),
    );
  }

  function removeLine(sectionIndex: number, lineIndex: number) {
    onChange(
      sections.map((section, index) => {
        if (index !== sectionIndex) return section;
        return { ...section, lines: section.lines.filter((_, li) => li !== lineIndex) };
      }),
    );
  }

  function addSection() {
    onChange([...sections, { title: '', lines: [''] }]);
  }

  return (
    <View style={styles.sectionsEditor}>
      {sections.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.sectionBlock}>
          {sections.length > 1 && (
            <TextInput
              testID={`${testIDPrefix}-section-title-${sectionIndex}`}
              style={styles.input}
              placeholder="Section title (optional)"
              placeholderTextColor={colors.textTertiary}
              value={section.title ?? ''}
              onChangeText={(value) => updateSectionTitle(sectionIndex, value)}
            />
          )}
          {section.lines.map((line, lineIndex) => (
            <View key={lineIndex} style={styles.lineRow}>
              <TextInput
                testID={`${testIDPrefix}-line-${sectionIndex}-${lineIndex}`}
                style={[styles.input, styles.lineInput]}
                placeholder={linePlaceholder}
                placeholderTextColor={colors.textTertiary}
                value={line}
                onChangeText={(value) => updateLine(sectionIndex, lineIndex, value)}
              />
              {section.lines.length > 1 && (
                <Button
                  title="✕"
                  variant="secondary"
                  onPress={() => removeLine(sectionIndex, lineIndex)}
                  testID={`${testIDPrefix}-remove-line-${sectionIndex}-${lineIndex}`}
                />
              )}
            </View>
          ))}
          <Button
            title={addLineLabel}
            variant="secondary"
            onPress={() => addLine(sectionIndex)}
            testID={`${testIDPrefix}-add-line-${sectionIndex}`}
          />
        </View>
      ))}
      <Button
        title={addSectionLabel}
        variant="secondary"
        onPress={addSection}
        testID={`${testIDPrefix}-add-section`}
      />
    </View>
  );
}

function groupCategories(categories: Category[]): [CategoryGroup, Category[]][] {
  const groups = new Map<CategoryGroup, Category[]>();
  for (const category of categories) {
    const existing = groups.get(category.groupName) ?? [];
    existing.push(category);
    groups.set(category.groupName, existing);
  }
  return Array.from(groups.entries());
}

function parseMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function cleanSections(sections: RecipeSection[]): RecipeSection[] {
  return sections
    .map((section) => ({
      title: section.title?.trim() || null,
      lines: section.lines.map((line) => line.trim()).filter((line) => line.length > 0),
    }))
    .filter((section) => section.lines.length > 0);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: {
    ...typography.heading,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowItem: {
    flex: 1,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroImage: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
  },
  heroActions: {
    gap: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tagInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  tagInput: {
    flex: 1,
  },
  sectionsEditor: {
    gap: spacing.md,
  },
  sectionBlock: {
    gap: spacing.xs,
  },
  lineRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
  },
  lineInput: {
    flex: 1,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
