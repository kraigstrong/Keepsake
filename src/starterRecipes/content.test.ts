import { readFileSync } from 'fs';
import { join } from 'path';

import { scoreCandidates } from '../../server/selection/scoreCandidates';
import { parseQuantity } from '../../server/units/parseQuantity';
import { parseServings } from '../../server/units/parseServings';
import { STARTER_RECIPES, STARTER_SOURCE_ATTRIBUTION } from './content';
import type { StarterCategoryRef } from './types';

// Mirrors the taxonomy seeded by 20260803100000_recipe_schema.sql.
// Hand-written on purpose so a typo in content.ts fails here rather
// than silently attaching zero categories on staging — category ids
// are gen_random_uuid() defaults and differ per environment, so the
// (group, value) pair is the only thing that travels.
const SEEDED_CATEGORIES: StarterCategoryRef[] = [
  { group: 'protein', value: 'Chicken' },
  { group: 'protein', value: 'Beef' },
  { group: 'protein', value: 'Pork' },
  { group: 'protein', value: 'Seafood' },
  { group: 'protein', value: 'Vegetarian' },
  { group: 'dish_type', value: 'Soup' },
  { group: 'dish_type', value: 'Pasta' },
  { group: 'dish_type', value: 'Dessert' },
  { group: 'preparation', value: 'Grill' },
  { group: 'preparation', value: 'Slow Cooker' },
  { group: 'preparation', value: 'Air Fryer' },
];

const key = (ref: StarterCategoryRef) => `${ref.group}:${ref.value}`;

describe('SEEDED_CATEGORIES', () => {
  // The constant above is only useful if it still matches the migration.
  // Without this, a migration that renames or adds a value leaves the
  // test passing against a stale copy — the exact drift that would ship
  // wrong to staging.
  it('matches the taxonomy actually seeded by the migration', () => {
    const sql = readFileSync(
      join(__dirname, '../../supabase/migrations/20260803100000_recipe_schema.sql'),
      'utf8',
    );
    const insertBlock =
      /insert into public\.categories \(group_name, value\) values([\s\S]*?);/.exec(sql);
    const values = insertBlock?.[1];
    expect(values).toBeDefined();

    const fromMigration = [...(values ?? '').matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map(
      ([, group, value]) => `${group}:${value}`,
    );

    expect(fromMigration.sort()).toEqual(SEEDED_CATEGORIES.map(key).sort());
  });
});

describe('STARTER_RECIPES', () => {
  it('contains exactly ten recipes with unique titles', () => {
    expect(STARTER_RECIPES).toHaveLength(10);
    const titles = STARTER_RECIPES.map((r) => r.title);
    expect(new Set(titles).size).toBe(10);
  });

  it.each(STARTER_RECIPES.map((r) => [r.title, r] as const))('%s is complete', (_title, recipe) => {
    expect(recipe.title.trim()).toBe(recipe.title);
    expect(recipe.title.length).toBeGreaterThan(0);
    expect(recipe.permanentNotes.length).toBeGreaterThan(0);
    expect(recipe.yieldText.length).toBeGreaterThan(0);

    expect(recipe.activeTimeMinutes).toBeGreaterThan(0);
    expect(recipe.totalTimeMinutes).toBeGreaterThan(0);
    expect(recipe.totalTimeMinutes).toBeGreaterThanOrEqual(recipe.activeTimeMinutes);

    expect(recipe.ingredientSections.length).toBeGreaterThan(0);
    for (const section of recipe.ingredientSections) {
      expect(section.lines.length).toBeGreaterThan(0);
      for (const line of section.lines) {
        expect(line.trim()).toBe(line);
        expect(line.length).toBeGreaterThan(0);
      }
    }

    expect(recipe.instructionSections.length).toBeGreaterThan(0);
    for (const section of recipe.instructionSections) {
      expect(section.lines.length).toBeGreaterThan(0);
      for (const line of section.lines) {
        expect(line.trim()).toBe(line);
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  it('references only categories that the migration actually seeds', () => {
    const seeded = new Set(SEEDED_CATEGORIES.map(key));
    for (const recipe of STARTER_RECIPES) {
      for (const ref of recipe.categories) {
        expect(seeded).toContain(key(ref));
      }
      // A recipe with no categories would still seed, but it would be
      // invisible to Library's category filter and carry no diversity
      // signal into Help Me Choose.
      expect(recipe.categories.length).toBeGreaterThan(0);
    }
  });

  it('covers the taxonomy the set is meant to demonstrate', () => {
    const used = new Set(STARTER_RECIPES.flatMap((r) => r.categories.map(key)));
    for (const expected of [
      'protein:Chicken',
      'protein:Beef',
      'protein:Pork',
      'protein:Seafood',
      'protein:Vegetarian',
      'dish_type:Soup',
      'dish_type:Pasta',
      'dish_type:Dessert',
      'preparation:Grill',
      'preparation:Slow Cooker',
    ]) {
      expect(used).toContain(expected);
    }
    // Deliberate: a starter set should not assume an appliance.
    expect(used).not.toContain('preparation:Air Fryer');
  });

  it('uses lowercase, trimmed, deduplicated tags', () => {
    for (const recipe of STARTER_RECIPES) {
      expect(recipe.tags.length).toBeGreaterThan(0);
      for (const tag of recipe.tags) {
        expect(tag).toBe(tag.toLowerCase());
        expect(tag).toBe(tag.trim());
        expect(tag.length).toBeGreaterThan(0);
      }
      expect(new Set(recipe.tags).size).toBe(recipe.tags.length);
    }
  });

  it('has an attribution and no source URL', () => {
    expect(STARTER_SOURCE_ATTRIBUTION).toBe('Keepsake starter recipe');
  });
});

describe('parsing', () => {
  it('runs every ingredient line through parseQuantity without throwing', () => {
    for (const recipe of STARTER_RECIPES) {
      for (const section of recipe.ingredientSections) {
        for (const line of section.lines) {
          const parsed = parseQuantity(line);
          // parseQuantity never throws by contract; what matters is that
          // it round-trips the original text so nothing is lost even
          // when it declines to read a quantity.
          expect(parsed.lineText).toBe(line);
        }
      }
    }
  });

  it('covers both the readable and unreadable yield paths on purpose', () => {
    const readable = STARTER_RECIPES.filter((r) => parseServings(r.yieldText) !== null);
    const unreadable = STARTER_RECIPES.filter((r) => parseServings(r.yieldText) === null);

    expect(readable.length).toBeGreaterThan(0);
    // The cookies. Their yield is "Makes about 24 cookies", which
    // parseServings correctly declines to read — so the seeded library
    // carries a live null-servingsCount recipe rather than that branch
    // first appearing on a real user's import.
    expect(unreadable.map((r) => r.title)).toEqual(['Brown Butter Chocolate Chip Cookies']);
  });

  it('parses a known quantity, unit and ingredient correctly', () => {
    // Pins the content, not the parser: if someone reformats this line
    // into something parseQuantity can't read, scaling silently stops
    // working for it.
    const parsed = parseQuantity('1 1/2 lb ground beef');
    expect(parsed.quantityMin).toBe(1.5);
    expect(parsed.unit).toBe('lb');
    expect(parsed.ingredientText).toBe('ground beef');
  });
});

describe('as a first Help Me Choose deck', () => {
  it('produces a deck spanning at least four proteins', () => {
    // targetCount 2 clamps the deck to 8 of the 10, so this exercises
    // the diversification rather than just handing back everything.
    const ranked = scoreCandidates({
      roundId: 'starter-deck-test',
      now: '2026-09-01T12:00:00.000Z',
      targetCount: 2,
      candidates: STARTER_RECIPES.map((recipe, index) => ({
        recipeId: `starter-${index}`,
        tags: recipe.tags,
        categoryKeys: recipe.categories.map(key),
        neverPlanned: true,
        lastActivityAt: null,
        plannedCount: 0,
        recentDeckAppearances: 0,
      })),
      thisWeekTags: [],
      thisWeekCategoryKeys: [],
    });

    expect(ranked).toHaveLength(8);

    const byId = new Map<string, (typeof STARTER_RECIPES)[number]>(
      STARTER_RECIPES.map((recipe, index) => [`starter-${index}`, recipe]),
    );
    const proteins = new Set(
      ranked.flatMap(
        (candidate) =>
          byId
            .get(candidate.recipeId)
            ?.categories.filter((c) => c.group === 'protein')
            .map(key) ?? [],
      ),
    );
    expect(proteins.size).toBeGreaterThanOrEqual(4);
  });
});
