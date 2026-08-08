import { canonicalKey } from './canonicalKey';
import { fnv1a64, itemHash } from './itemHash';

describe('fnv1a64', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a64('onion')).toBe(fnv1a64('onion'));
  });

  it('produces different hashes for different inputs', () => {
    expect(fnv1a64('onion')).not.toBe(fnv1a64('garlic'));
  });

  it('returns a fixed-length lowercase hex string', () => {
    expect(fnv1a64('onion')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('itemHash', () => {
  it('is stable across regenerations for the same canonical identity', () => {
    // The whole point (ADR-0022 decision 6): a re-render that
    // recomputes the grocery list from scratch must still resolve
    // "onions" and "onion" to the same persisted selection row.
    const first = itemHash(canonicalKey('onions, diced'));
    const second = itemHash(canonicalKey('onion, chopped'));
    expect(first).toBe(second);
  });

  it('distinguishes genuinely different ingredients', () => {
    expect(itemHash(canonicalKey('yellow onion'))).not.toBe(itemHash(canonicalKey('onion')));
  });
});
