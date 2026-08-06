/**
 * Composes a full display string for one ingredient line at a given
 * scale/system, per ADR-0018. An unparsed line (quantityMin null) —
 * malformed or never confidently read — always falls back to lineText
 * verbatim: "Original values never lost" and "Malformed imported
 * quantities" both hold by construction here, not by a special case
 * bolted on afterward.
 *
 * A range (quantityMin !== quantityMax) formats both bounds
 * independently and shows one shared "~" if either bound was rounded.
 */

import { unitLabel, type Unit } from './quantityVocabulary';
import { formatQuantity } from './formatQuantity';

export interface FormattableIngredientLine {
  lineText: string;
  quantityMin: number | null;
  quantityMax: number | null;
  unit: Unit | null;
  ingredientText: string | null;
}

export function formatIngredientLine(line: FormattableIngredientLine): string {
  if (line.quantityMin === null) {
    return line.lineText;
  }

  const quantityMax = line.quantityMax ?? line.quantityMin;
  const min = formatQuantity(line.quantityMin, line.unit);
  const max = formatQuantity(quantityMax, line.unit);
  const isApproximate = min.isApproximate || max.isApproximate;

  const quantityDisplay = min.display === max.display ? min.display : `${min.display}-${max.display}`;
  const unitDisplay = line.unit ? ` ${unitLabel(line.unit, quantityMax)}` : '';
  const ingredientDisplay = line.ingredientText ? ` ${line.ingredientText}` : '';

  return `${isApproximate ? '~' : ''}${quantityDisplay}${unitDisplay}${ingredientDisplay}`;
}
