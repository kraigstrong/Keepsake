import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  type Category,
  type CategoryGroup,
  fetchCategories,
  fetchDraft,
  fetchRecipe,
  type IngredientSection,
  isRecipeConflictError,
  type Recipe,
  type RecipeDraftPayload,
  type RecipeSavePayload,
  type RecipeSection,
  saveDraft,
  saveRecipe,
} from './api';
import { parseQuantity } from '../../server/units/parseQuantity';
import { parseServings } from '../../server/units/parseServings';
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
import { CloseIcon } from '../components/icons/CloseIcon';
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

// A loaded recipe's ingredient lines are parsed objects; a draft's are
// still plain edited text (ADR-0018 — parsing happens once, at the
// actual save). The editor's own state is always plain text either
// way, so a fetched recipe's lines collapse back to lineText here.
// Module-scope and pure (no component state) — kept out of the
// component body so it's a stable reference, not one recreated (and
// needing to be re-listed as a hook dependency) on every render.
function toEditableIngredientSections(
  sections: IngredientSection[] | RecipeSection[],
): RecipeSection[] {
  return sections.map((section) => ({
    title: section.title,
    lines: section.lines.map((line) => (typeof line === 'string' ? line : line.lineText)),
  }));
}

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
  const [hasConflict, setHasConflict] = useState(false);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  // Skips the autosave effect's very first post-load firing, which
  // would otherwise write the just-loaded, unedited content back as a
  // "draft" before the user has actually changed anything.
  const skipNextAutosave = useRef(true);

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

  function applyFormFields(fields: RecipeDraftPayload | Recipe) {
    setTitle(fields.title);
    setHeroImagePath(fields.heroImagePath ?? null);
    setActiveTimeMinutes(fields.activeTimeMinutes?.toString() ?? '');
    setTotalTimeMinutes(fields.totalTimeMinutes?.toString() ?? '');
    setYieldText(fields.yieldText ?? '');
    setPermanentNotes(fields.permanentNotes ?? '');
    setSourceUrl(fields.sourceUrl ?? '');
    setSourceAttribution(fields.sourceAttribution ?? '');
    setTags(fields.tags);
    setCategoryIds(fields.categoryIds);
    setIngredientSections(
      fields.ingredientSections.length > 0
        ? toEditableIngredientSections(fields.ingredientSections)
        : EMPTY_SECTIONS,
    );
    setInstructionSections(
      fields.instructionSections.length > 0 ? fields.instructionSections : EMPTY_SECTIONS,
    );
  }

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

    function loadHeroPreview(path: string) {
      getHeroImageUrl(path).then((url) => {
        if (!cancelled && url) setHeroPreviewUri(url);
      });
    }

    // A draft always wins over the server copy if one exists — it's
    // the user's own more-recent, unsaved work. Loaded after the
    // recipe (when editing) so baseVersion still reflects the real
    // server state the conflict check needs, even though the visible
    // form fields come from the draft.
    function loadDraft() {
      fetchDraft(recipeId ?? null)
        .then((draft) => {
          if (cancelled || !draft) return;
          applyFormFields(draft);
          if (draft.heroImagePath) loadHeroPreview(draft.heroImagePath);
        })
        .catch(() => {
          // No draft, or the fetch failed — starting from the server
          // copy (or blank, for a new recipe) either way.
        });
    }

    if (recipeId) {
      fetchRecipe(recipeId)
        .then((recipe) => {
          if (cancelled) return;
          applyFormFields(recipe);
          setBaseVersion(recipe.version);
          setIsLoading(false);
          if (recipe.heroImagePath) loadHeroPreview(recipe.heroImagePath);
          loadDraft();
        })
        .catch(() => {
          if (!cancelled) {
            setLoadError(true);
            setIsLoading(false);
          }
        });
    } else {
      loadDraft();
    }

    return () => {
      cancelled = true;
    };
    // Deliberately runs once per recipeId — re-running on every render
    // would clobber in-progress edits with the server copy.
  }, [recipeId]);

  useEffect(() => {
    if (isLoading) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }

    const draftPayload: RecipeDraftPayload = {
      title,
      heroImagePath,
      activeTimeMinutes: parseMinutes(activeTimeMinutes),
      totalTimeMinutes: parseMinutes(totalTimeMinutes),
      yieldText: yieldText.trim() || null,
      permanentNotes: permanentNotes.trim() || null,
      sourceUrl: sourceUrl.trim() || null,
      sourceAttribution: sourceAttribution.trim() || null,
      tags,
      categoryIds,
      ingredientSections,
      instructionSections,
    };

    const timeoutId = setTimeout(() => {
      saveDraft(recipeId ?? null, draftPayload).catch(() => {
        // Best-effort — a failed autosave isn't worth interrupting the
        // user over. Explicit Save is still the real save path.
      });
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [
    isLoading,
    recipeId,
    title,
    heroImagePath,
    activeTimeMinutes,
    totalTimeMinutes,
    yieldText,
    permanentNotes,
    sourceUrl,
    sourceAttribution,
    tags,
    categoryIds,
    ingredientSections,
    instructionSections,
  ]);

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
    setHasConflict(false);
    if (title.trim().length === 0) {
      setSaveError('Title is required.');
      return;
    }

    setIsSaving(true);
    try {
      const payload: RecipeSavePayload = {
        id: recipeId,
        baseVersion: baseVersion ?? undefined,
        title: title.trim(),
        heroImagePath,
        activeTimeMinutes: parseMinutes(activeTimeMinutes),
        totalTimeMinutes: parseMinutes(totalTimeMinutes),
        yieldText: yieldText.trim() || null,
        servingsCount: parseServings(yieldText.trim() || null),
        permanentNotes: permanentNotes.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        sourceAttribution: sourceAttribution.trim() || null,
        tags,
        categoryIds,
        ingredientSections: cleanSections(ingredientSections).map((section) => ({
          title: section.title,
          lines: section.lines.map(parseQuantity),
        })),
        instructionSections: cleanSections(instructionSections),
      };
      const { id } = await saveRecipe(payload);
      router.replace(`/recipe/${id}`);
    } catch (err) {
      if (isRecipeConflictError(err)) {
        setHasConflict(true);
      } else {
        setSaveError('Could not save this recipe. Try again.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  // The user's own in-progress edits stay in their draft either way —
  // reloading only replaces what's on screen with the fresh server
  // copy, it doesn't discard anything they've typed from storage. If
  // they keep editing after this, autosave naturally supersedes the
  // draft with their new changes against the now-current baseVersion.
  async function handleReloadLatest() {
    if (!recipeId) return;
    setHasConflict(false);
    setIsLoading(true);
    try {
      const recipe = await fetchRecipe(recipeId);
      applyFormFields(recipe);
      setBaseVersion(recipe.version);
      setHeroPreviewUri(null);
      if (recipe.heroImagePath) {
        const url = await getHeroImageUrl(recipe.heroImagePath);
        if (url) setHeroPreviewUri(url);
      }
    } catch {
      setSaveError('Could not reload the latest version. Try again.');
    } finally {
      setIsLoading(false);
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
        removeLineLabel="Remove ingredient"
        addSectionLabel="Add section"
        testIDPrefix="recipe-ingredients"
      />

      <Text style={styles.sectionLabel}>Instructions</Text>
      <SectionsEditor
        sections={instructionSections}
        onChange={setInstructionSections}
        linePlaceholder="Preheat the oven…"
        addLineLabel="Add step"
        removeLineLabel="Remove step"
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

      {hasConflict ? (
        <View style={styles.conflictBox} testID="recipe-editor-conflict">
          <Text style={styles.error} accessibilityRole="alert">
            This recipe was changed by someone else. Reload to see the latest version, then redo
            your changes.
          </Text>
          <Button
            title="Reload latest version"
            variant="secondary"
            onPress={handleReloadLatest}
            testID="recipe-editor-reload-button"
          />
        </View>
      ) : (
        saveError && (
          <Text style={styles.error} testID="recipe-editor-error" accessibilityRole="alert">
            {saveError}
          </Text>
        )
      )}

      <Button
        title={isSaving ? 'Saving…' : 'Save'}
        onPress={handleSave}
        disabled={isSaving || hasConflict}
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
  removeLineLabel,
  addSectionLabel,
  testIDPrefix,
}: {
  sections: RecipeSection[];
  onChange: (sections: RecipeSection[]) => void;
  linePlaceholder: string;
  addLineLabel: string;
  removeLineLabel: string;
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
                <Pressable
                  onPress={() => removeLine(sectionIndex, lineIndex)}
                  accessibilityRole="button"
                  // The control is the glyph alone, so it carries no text
                  // for a screen reader to fall back on — hence an
                  // explicit label, and one worded per section type.
                  accessibilityLabel={removeLineLabel}
                  // Asymmetric: a symmetric 10px slop would reach 4px
                  // past the 6px lineRow gap into the TextInput's own
                  // touch area, so a tap near the input's right edge to
                  // place the cursor could hit this button instead.
                  hitSlop={{ top: 10, bottom: 10, left: 4, right: 10 }}
                  style={styles.removeLineButton}
                  testID={`${testIDPrefix}-remove-line-${sectionIndex}-${lineIndex}`}
                >
                  <CloseIcon color={colors.textSecondary} size={20} />
                </Pressable>
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
    ...typography.input,
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
  removeLineButton: {
    alignItems: 'center',
    justifyContent: 'center',
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
  conflictBox: {
    gap: spacing.xs,
  },
});
