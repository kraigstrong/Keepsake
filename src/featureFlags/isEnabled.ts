import { FLAGS } from './flags';

/**
 * An unregistered flag name reads as false rather than throwing — a typo
 * or a not-yet-added flag should fail closed (feature off), not crash.
 */
export function isEnabled(flag: string): boolean {
  return FLAGS[flag] ?? false;
}
