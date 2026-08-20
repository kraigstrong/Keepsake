# Current Status

A pointer to what's actively selected right now, not a log — update it when the active work item's state, blocker, or next action materially changes. `docs/roadmap.md` holds the milestone/backlog layer; `docs/history/phase-NN-*.md` holds phase-by-phase build history, one file per phase.

## Active work item

`docs/roadmap.md`'s **MVP Validation** milestone. The six-journey refresh is done (2026-08-18); the remaining backlog item is the live joint session to close Journeys 1 and 3 (see Blocked, below).

## Current state

- Four of six journeys (offline, lifecycle, security, credential validation) are re-confirmed against current code/CI — see `docs/roadmap.md`'s MVP Validation status for the per-journey summary.
- `phase-17-walkthrough-feedback` (PR #63, merged 2026-08-17) landed real changes across Journey 1's ground (unit system, notes/history, grocery display) that are test-covered but not yet live-walked — see `docs/history/phase-17-walkthrough-feedback.md`.
- Parallel, code-only reliability work picked up while blocked: transport-failure retry for recipe imports shipped ([PR #77](https://github.com/kraigstrong/Keepsake/pull/77), merged) — see `docs/roadmap.md`'s Reliability milestone. Category-mapping robustness (ORG-04/AI-06) also shipped ([PR #79](https://github.com/kraigstrong/Keepsake/pull/79), merged 2026-08-19) — see `docs/history/phase-08-url-import.md`. That review's follow-on item (enforce the category vocabulary at the schema/decoding level) was picked up next but its premise turned out to be wrong on inspection — `@anthropic-ai/sdk`'s structured-output path doesn't actually forward `enum` as a real constraint, and forcing it client-side would turn a graceful degrade into a hard import failure. Reframed rather than implemented; see `docs/roadmap.md`'s Reliability backlog for the full finding. Picked up structured server error logging instead (branch `reliability/server-error-logging`, not yet pushed) — `supabase/functions/import-recipe/index.ts` now logs the failure branches that indicate the pipeline itself broke, not user-input/expected-race outcomes. Full local CI sequence (typecheck/lint/format/test/check:client-secrets) green.

## Blocked

Journeys 1 (website success — the URL-import leg needs the developer watching a real Anthropic call, per this project's live-API-test convention) and 3 (shared household — a two-actor walkthrough) need a live developer session that neither automated tests nor pgTAP's single-transaction model can substitute for.

## Next action

Schedule the joint live session to close Journeys 1 and 3, then finish MVP Validation by updating `docs/roadmap.md` and `docs/prd-traceability.md` with the results. Until that session happens, pick another code-only item from `docs/roadmap.md`'s Reliability, Security & Privacy Readiness, or Not-yet-triaged backlogs — the same way T15 and the retry-behavior work were picked up.

## Recently shipped

- Category-mapping robustness (ORG-04/AI-06) — [PR #79](https://github.com/kraigstrong/Keepsake/pull/79). See `docs/history/phase-08-url-import.md`.
- Orphaned-photo Storage cleanup (T15) — [PR #76](https://github.com/kraigstrong/Keepsake/pull/76). See `docs/threat-model.md`'s T15 entry.
- Staging magic-link/OTP email fix — [PR #74](https://github.com/kraigstrong/Keepsake/pull/74). See `docs/history/cross-cutting-otp-email-fix.md`.
