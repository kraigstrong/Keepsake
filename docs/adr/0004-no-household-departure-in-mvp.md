# ADR-0004: Leaving a household is out of scope for MVP

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 0

## Context

The original Phase 3 build scope included "Leave household" as a feature, but the PRD never specified what happens to a user after they leave — do they land in a new empty household, get blocked with no household, or something else? Pantry's real usage pattern (per PRD §3, §6) is one or two adults in a single household that doesn't change membership often. Building and testing departure/re-homing flows adds real surface area (new household creation after leaving, orphaned-household handling, access-revocation timing) for a case that may not occur in practice during MVP use.

## Decision

Household departure is cut from MVP entirely. A household's membership, once established, is fixed for MVP. This is now stated explicitly in `docs/prd.md` §6.

## Alternatives considered

- **Build a minimal "leave" that just deletes the membership row:** rejected — even the minimal version needs an answer for "what does this user see next," and a half-specified answer is worse than not building it, per the PRD's own principle (§2.1: if a feature creates more decisions than value, remove it).
- **Keep it as a v1.1 stretch item inside MVP:** rejected in favor of a clean cut — it's not in the Final MVP Acceptance Matrix or Definition of Done, and leaving it "maybe later this phase" invites scope creep back in.

## Consequences

- Phase 3's build scope no longer includes "Leave household."
- Phase 17's security validation journey now tests sign-out (session/cache clearing) instead of "a member leaves" for its access-revocation check, since the leave path won't exist to test.
- If household departure becomes necessary later (e.g., a household splits, someone wants out), it's a v1.1+ feature with its own PRD treatment — not something to bolt onto Phase 3 informally.
