/**
 * Deterministic identity hash for a canonical grocery item (ADR-0022
 * decision 6) — the merge key's stable identity across regenerations,
 * used to reattach a household's include/exclude choice
 * (grocery_item_selections.item_hash) to "the same" item on every
 * fresh, recomputed list. Non-cryptographic on purpose: collision
 * resistance only needs to hold within one household's own grocery
 * vocabulary, so a fast synchronous FNV-1a beats an async
 * crypto.subtle.digest() for looping over a whole plan's ingredients,
 * with no real security stake either way.
 */

const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function itemHash(canonicalKey: string): string {
  return fnv1a64(canonicalKey);
}
