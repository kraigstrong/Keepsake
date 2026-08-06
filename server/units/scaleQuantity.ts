/**
 * Multiplies a quantity (single value or range) by a scaling factor —
 * a preset chip (1/2x-4x) or an arbitrary-serving-count-derived ratio
 * feed the same multiplier here, so there is one scaling code path,
 * not two (ADR-0018). An unparsed quantity (quantityMin null) is left
 * untouched: nothing to scale, and it must keep displaying as the
 * original lineText regardless of the active multiplier.
 */

export interface ScalableQuantity {
  quantityMin: number | null;
  quantityMax: number | null;
}

export function scaleQuantity<T extends ScalableQuantity>(quantity: T, multiplier: number): T {
  if (quantity.quantityMin === null) {
    return quantity;
  }
  return {
    ...quantity,
    quantityMin: quantity.quantityMin * multiplier,
    quantityMax: quantity.quantityMax === null ? null : quantity.quantityMax * multiplier,
  };
}
