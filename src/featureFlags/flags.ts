/**
 * Feature flags: local, typed, build-time only — no third-party flag
 * service (see ADR-0006; disproportionate at this project's stage).
 * Changing a flag value requires a new build, not a remote toggle.
 *
 * Every flag is temporary scaffolding, not a permanent switch — for a
 * permanent platform or environment distinction (e.g. "is this the web
 * build"), use a real capability/environment check instead, not a flag.
 *
 * execution-plan.md §2.10 requires "Removal of temporary flags" as an
 * explicit commit step, not a someday cleanup. Every flag added here
 * needs a one-line removal condition in its comment, so the person who
 * eventually removes it doesn't have to reconstruct the intent:
 *
 *   someNewFeature: false, // remove once REC-01 ships in Phase 4
 */
export const FLAGS: Record<string, boolean> = {
  // On for everyone as of 2026-08-28 (developer decision) — solo flow only;
  // group is post-beta and does not gate this. Remove the flag entirely once
  // the Friends & Family Preview has run and the feature is staying.
  smartMealSelection: true,
};
