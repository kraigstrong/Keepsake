import { convertToSystem } from '../../server/units/convertUnit';
import { formatIngredientLine } from '../../server/units/formatIngredientLine';
import type { UnitSystem } from '../../server/units/quantityVocabulary';
import { scaleQuantity } from '../../server/units/scaleQuantity';
import type { IngredientSection } from './api';

// A recipe whose yield doesn't parse to a serving count (free text like
// "1 loaf") still needs some positive servings value to plan with —
// this default is the same "typical household" assumption the design
// doc's own seed recipes use throughout ("Serves 4"). Shared between
// RecipeDetailScreen and CookingModeScreen (Phase 15) — both scale the
// same recipe data the same way (ADR-0018).
export const DEFAULT_SERVINGS_WHEN_UNKNOWN = 4;

// ADR-0018: presets are screen-local and reset every visit — a recipe
// never "remembers" a prior scaling, Original is always one tap away.
export const SCALE_PRESETS: { label: string; multiplier: number }[] = [
  { label: '½×', multiplier: 0.5 },
  { label: '1×', multiplier: 1 },
  { label: '1½×', multiplier: 1.5 },
  { label: '2×', multiplier: 2 },
  { label: '3×', multiplier: 3 },
  { label: '4×', multiplier: 4 },
];

export function scaledIngredientSections(
  sections: IngredientSection[],
  multiplier: number,
  displayMode: 'original' | 'preferred',
  preferredUnitSystem: UnitSystem | null,
): { title: string | null; lines: string[] }[] {
  return sections.map((section) => ({
    title: section.title,
    lines: section.lines.map((line) => {
      let quantity = scaleQuantity(line, multiplier);
      if (displayMode === 'preferred' && preferredUnitSystem) {
        quantity = convertToSystem(quantity, preferredUnitSystem);
      }
      return formatIngredientLine({ ...line, ...quantity });
    }),
  }));
}
