# PRD Traceability

Every PRD requirement gets a stable ID, an owning phase (from `docs/execution-plan.md`), and a status. Update the status column as work lands — don't wait for phase exit to update it. Statuses: `Not Started`, `In Progress`, `Done (untested)`, `Done (tested)`, `Deferred`.

This file is the evidence index referenced by execution-plan.md §2.3 and the exit-gate review (§3.6). A phase should not exit while its owned requirements are `Not Started`.

## Household (HH)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| HH-01 | One shared household | 3 | Done (tested) |
| HH-02 | Multiple household members | 3 | Done (tested) |
| HH-03 | Equal permissions for all members | 3 | Done (tested) |

## Recipe Model (REC)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| REC-01 | Title, hero image, active/total time, yield | 4 | Done (tested) |
| REC-02 | Ingredient sections | 4 | Done (tested) |
| REC-03 | Instruction sections | 4 | Done (tested) |
| REC-04 | Permanent notes | 4 | Done (tested) |
| REC-05 | Cooking history, separate from permanent notes | 15 | Done (tested)Δ |
| REC-06 | Source URL and attribution | 4 / 8 | Done (tested) |
| REC-07 | Structured categories and tags on the recipe | 4 | Done (tested) |
| REC-08 | Version history | 5 | Done (tested) |
| REC-09 | No recipe description field exists | 4 | Done (tested) |

Δ See the Cooking Mode (COOK) section below for the full footnote — same evidence and same still-open physical-device gate.

## Import (IMP)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| IMP-01 | Website URL import | 8 | Done (tested) |
| IMP-02 | Safari Share Sheet import | 9 | Done (untested) — Simulator-verified live, physical-device confirmation pending |
| IMP-03 | Bulk URL import | 9 | Done (tested) |
| IMP-04 | Camera import | 10 | Done (tested) |
| IMP-05 | Existing photo import | 10 | Done (tested) |
| IMP-06 | Manual creation | 4 | Done (tested) |
| IMP-07 | No mandatory review step after import | 8 | Done (tested) |

## AI Responsibilities (AI)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| AI-01 | Remove blog content | 8 | Done (tested) |
| AI-02 | Rewrite instructions clearly | 8 | Done (tested) |
| AI-03 | Include ingredient quantities inline | 8 | Done (tested) |
| AI-04 | Identify sections | 8 | Done (tested) |
| AI-05 | Infer timing | 8 | Done (tested) |
| AI-06 | Infer categories and tags | 8 | Done (tested) |
| AI-07 | Detect and highlight ambiguity | 8 | Done (tested) |
| AI-08 | Never confidently invent missing information | 8 (cross-cutting) | Done (tested) |

## Images (IMG)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| IMG-01 | Website recipe images stored locally, never hotlinked | 8 | Done (tested) |
| IMG-02 | Photo import preserves the original image | 10 | Done (tested) |
| IMG-03 | Original photo viewable later | 10 | Done (tested) |
| IMG-04 | Replace / crop-square / remove image | 4 / 10 | Done (tested) |

## Units and Scaling (UNIT)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| UNIT-01 | Original quantity values are always stored | 11 | Done (tested) |
| UNIT-02 | Display toggle: Original vs. Preferred (global user preference) | 11 | Done (tested) |
| UNIT-03 | Only safe conversions are offered | 11 | Done (tested) |
| UNIT-04 | Scaling presets ½×, 1×, 1½×, 2×, 3×, 4× | 11 | Done (tested) |
| UNIT-05 | Arbitrary serving count for recipes with servings | 11 | Done (tested) |
| UNIT-06 | Kitchen-friendly rounding | 11 | Done (tested) |

## Organization (ORG)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| ORG-01 | Structured categories: Protein / Dish Type / Preparation | 4 | Done (tested) |
| ORG-02 | Multiple category selections allowed | 4 | Done (tested) |
| ORG-03 | Free-form tags supported | 4 | Done (tested) |
| ORG-04 | AI suggests categories and tags | 8 | Done (tested) |

## Search (SRCH)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| SRCH-01 | Search covers title, ingredients, notes, author, source, categories, tags | 7 | Done (tested) |
| SRCH-02 | Priority: title \> ingredients \> everything else | 7 | Done (tested) |
| SRCH-03 | Typo tolerance | 7 | Done (tested) |
| SRCH-04 | Singular/plural matching | 7 | Done (tested) |
| SRCH-05 | Results show titles only | 7 | Done (tested) |

## Library (LIB)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| LIB-01 | Default sort: Recently Added (\<2wk) \> Frequently Selected \> remaining | 7 (Frequently Selected: 12) | Done (tested)¤ |
| LIB-02 | Additional sorts: Smart / Alphabetical / Recently Added / Frequently Selected | 7 (Frequently Selected: 12) | Done (tested)¤ |
| LIB-03 | Recipe rows show title only, no metadata clutter | 7 | Done (tested) |
| LIB-04 | Filters with active filter count | 7 | Done (tested) |

¤ Status was stale — left "In Progress" since Phase 7 despite full implementation landing by Phase 12. `src/recipes/librarySort.ts` implements all four modes (`smartSort`'s recently-added/frequently-selected/remaining tiering matches LIB-01's exact ordering; `alphabetical`/`recentlyAdded`/`frequentlySelected` cover LIB-02), wired into `LibraryScreen.tsx`'s sort control, covered by `librarySort.test.ts` (each mode's ordering, tie-breaking, the 2-week boundary, non-mutation) and `sortPreference.test.ts` (persisted selection). Corrected 2026-08-13 during Phase 17's traceability sweep. The 2-week boundary itself was off by one at the time of that correction — a recipe created exactly 14 days ago was treated as still inside the window (`>= cutoff`), one day past what "\<2wk" (strict) requires; fixed 2026-08-16 (Codex review, PR #54) to `> cutoff`, with boundary tests on both sides of the cutoff.

## This Week / Planning (WEEK)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| WEEK-01 | This Week is the default screen | 2 / 12 | Done (tested) |
| WEEK-02 | Select recipes → choose servings → review → confirm | 12 | Done (tested) |
| WEEK-03 | Confirming increments planned count | 12 | Done (tested)† |
| WEEK-04 | Cards show image and title | 12 | Done (tested) |
| WEEK-05 | Drag-to-reorder | 12 | Done (tested)‡ |
| WEEK-06 | Ordered shortlist, not a meal calendar (no weekday/meal assignment) | 12 | Done (untested)‖ |
| WEEK-07 | Multi-member synchronization of the shared plan | 12 | Done (tested)§ |

† pgTAP evidence only (`supabase/tests/database/weekly_plan_rpcs.test.sql`) — not run locally (no Docker in this environment, see `docs/history/phase-12-this-week-planning.md`); CI is the real gate before merge.
‡ Implemented as tap-based up/down move buttons, not literal drag-and-drop — `react-native-draggable-flatlist` is incompatible with this app's `react-native-reanimated` 4.5.1 (throws at module load); developer-approved pivot, see ADR-0021 and `docs/history/phase-12-this-week-planning.md`.
§ Refetch-on-focus/reconnect, not a live subscription — no Realtime in this app yet (ADR-0021's own tradeoff, explicitly deferred, not an oversight).

‖ A negative/absence requirement with no natural automated assertion; visually confirmed on physical device during the 2026-08-08/09 Phase 12/13/14 walkthrough (`docs/history/phase-12-this-week-planning.md`) — stays "untested" in the status-column sense (no test asserts the absence), not a gap.

## Frequently Selected (FREQ)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| FREQ-01 | Based on planned count, not cooking count | 12 | Done (tested) |
| FREQ-02 | Archived recipes excluded | 16 | Done (tested)# |

## Cooking Mode (COOK)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| COOK-01 | Single scrolling cooking screen | 15 | Done (tested)Δ |
| COOK-02 | Keep screen awake | 15 | Done (tested)Δ |
| COOK-03 | Check off ingredients and instructions | 15 | Done (tested)Δ |
| COOK-04 | Checklist progress is device-specific | 15 | Done (tested)Δ |
| COOK-05 | Done Cooking clears progress, records timestamp, optional removal from This Week | 15 | Done (tested)Δ |
| COOK-06 | Done Cooking prompts for a cooking note | 15 | Done (tested)Δ |

## Cooking Notes (NOTE)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| NOTE-01 | Short note capture after cooking | 15 | Done (tested)Δ |
| NOTE-02 | Chronological note history | 15 | Done (tested)Δ |
| NOTE-03 | Newest note preview near top | 15 | Done (tested)Δ |
| NOTE-04 | Permanent recipe notes remain a separate concept | 4 / 15 | Done (tested)Δ |

Δ Jest coverage only (`src/cooking/*.test.ts(x)`, `src/recipes/RecipeDetailScreen.test.tsx`'s cooking-history cases) — no pgTAP for `cooking_events`' RPCs run locally (no Docker in this environment; `supabase/tests/database/cooking_event_rpcs.test.sql` is CI-only, same convention as every phase since 12). ADR-0003 requires a **physical device** for this phase's own exit gate (screen-awake/real-kitchen-use class, same reasoning as Phase 15's keep-awake risk spike) — not yet performed; see `docs/current.md`.

## Grocery Export (GRO)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| GRO-01 | Grouped review before export | 13 | Done (tested)¶ |
| GRO-02 | Include/exclude items | 13 | Done (tested)¶ |
| GRO-03 | Apple Reminders export (only export target for MVP) | 14 | Done (tested)§ |
| GRO-04 | Standard categories: Produce / Meat / Frozen / Dairy / Pantry / Other | 13 | Done (tested)¶ |
| GRO-05 | Conservative ingredient merging, no merge UI | 13 | Done (tested)¶ |
| GRO-06 | Staples omitted by default | 13 | Done (tested)¶ |
| GRO-07 | No editing within the export flow | 13 / 14 | Done (tested)¶§ |

¶ Phase 13's own pgTAP coverage (`supabase/tests/database/grocery_item_selection_rpc.test.sql`) is CI-only, not run locally (no Docker in this environment); Jest coverage for the generation/merge/category/staple logic (`server/groceries/*.test.ts`, `src/groceries/api.test.ts`, `src/groceries/GroceryReviewScreen.test.tsx`) ran locally. Live physical-device walkthrough performed 2026-08-08/09, found and fixed five generation/categorization bugs ([PR #47](https://github.com/kraigstrong/Keepsake/pull/47)); see `docs/history/phase-13-grocery-generation.md`.

§ Phase 14 has no server component at all (ADR-0023 — export bookkeeping is local-only) and so no pgTAP; Jest coverage (`src/reminders/*.test.ts`, `src/groceries/GroceryExportPanel.test.tsx`) mocks EventKit/permissions/local SQLite. ADR-0003 requires a **physical device**, not just Simulator, for this phase's exit gate (screen-awake-adjacent native-capability class) — performed 2026-08-08/09 alongside Phase 13's own walkthrough; found and fixed a real stale-export-dedup bug (ADR-0023 amendment, [PR #47](https://github.com/kraigstrong/Keepsake/pull/47)); see `docs/history/phase-14-reminders-export.md`.

## Lifecycle: Archive & Delete (LIFE)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| LIFE-01 | Archive hides a recipe from Library, Search, Planning, Frequently Selected, Recently Added | 16 | Done (tested)# |
| LIFE-02 | Archived Recipes reachable from the overflow menu | 16 | Done (tested)#\* |
| LIFE-03 | Unarchive | 16 | Done (tested)# |
| LIFE-04 | Delete requires confirmation, moves recipe to Recently Deleted | 16 | Done (tested)# |
| LIFE-05 | Recently Deleted is shared and does not auto-expire in MVP | 16 | Done (tested)#‖ |
| LIFE-06 | Restore from Recently Deleted | 16 | Done (tested)# |
| LIFE-07 | Permanent delete | 16 | Done (tested)# |

\* Deviation, not a gap: this app has never built an overflow menu, so Archived Recipes is reached from Settings instead, and Archive/Unarchive live as plain buttons in Recipe Detail's existing action row — see ADR-0025 decision 7.

\# Phase 16 (ADR-0025). pgTAP coverage (`supabase/tests/database/recipe_lifecycle_rpcs.test.sql`, `recipes_source_url_uniqueness.test.sql`) is CI-only, not run locally (no Docker in this environment). Jest coverage spans the data layer (`src/recipes/api.test.ts`), the archived/deleted exclusion filters (`src/sync/offlineRecipes.test.ts`, `src/search/buildSearchQuery.test.ts`, `src/search/searchCorrectness.test.ts`, `src/search/searchPerformance.test.ts`), Recipe Detail's archive/delete actions (`src/recipes/RecipeDetailScreen.test.tsx`), and both new screens (`src/recipes/ArchivedRecipesScreen.test.tsx`, `src/recipes/RecentlyDeletedScreen.test.tsx`).

## Offline (OFF)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| OFF-01 | Offline browsing | 6 | Done (tested) |
| OFF-02 | Offline searching | 6 / 7 | Done (tested) |
| OFF-03 | Offline cooking | 15 | Done (tested)Δ |
| OFF-04 | Imports, editing, planning, and grocery export require connectivity | 6 (boundary), enforced per feature phase | Done (tested)¥ |
| OFF-05 | Cooking completion queues locally and syncs on reconnect | 15 | Done (tested)Δ |

¥ Status was stale ("Not Started" despite every feature phase since 6 enforcing this). Two enforcement patterns, both real: This Week and Grocery Review proactively gate on `ConnectivityProvider` with a dedicated offline state (`ThisWeekScreen.test.tsx`/`GroceryReviewScreen.test.tsx`, "shows an offline state and never fetches while offline"); Import and Recipe Editor have no pre-check but every mutating call is wrapped in error handling that surfaces a network failure as an error state rather than hanging or silently no-opping (`ImportRecipeScreen.tsx`, `RecipeEditorScreen.tsx` — both have `catch` blocks feeding `ErrorState`/inline error text). Either way, no code path in this app can write while offline (ADR-0013: the local mirror is read-only). Corrected 2026-08-13 during Phase 17's traceability sweep.

Δ See the Cooking Mode (COOK) section above for the full footnote — same evidence and same still-open physical-device gate.

## Version History (VER)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| VER-01 | A version is created only on explicit save | 5 | Done (tested) |
| VER-02 | Autosaves remain temporary drafts | 5 | Done (tested) |
| VER-03 | Restore a previous version | 5 | Done (tested) |
| VER-04 | Restoring creates a new version; later history is preserved | 5 | Done (tested) |

## Security (SEC)

Cross-cutting per execution-plan.md §2.6 — every phase must address these where relevant; the ID marks where each is primarily concentrated.

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| SEC-01 | No secret is ever committed to Git | Continuous, gated at 0 | Done (tested) |
| SEC-02 | Approved secret management (1Password) is used | 0 | Done (tested) |
| SEC-03 | Household data is protected server-side (RLS) | 3 | Done (tested) |
| SEC-04 | Storage is restricted by membership | 3 | Done (tested) |
| SEC-05 | Sensitive content is excluded from telemetry | Continuous, gated at 2 | Done (tested) |
| SEC-06 | External input is validated | 8 (primary), continuous | Done (tested)£ |
| SEC-07 | Destructive operations are authorized and idempotent | 16 (primary), continuous | Done (tested) |
| SEC-08 | Security scanning runs in CI | 0 | Done (tested) |
| SEC-09 | Dependencies are reviewed and scanned | 0 | Done (tested) |
| SEC-10 | Security is validated in every phase | Continuous | In Progress |

£ Status was stale ("Not Started" despite Phase 8 having built this). SSRF-hardened fetch validates every URL and DNS resolution before and after each redirect (`server/import/secureFetch.ts`, `secureFetch.test.ts`); AI extraction output is validated against a `zod` schema before use (`server/ai/extractRecipe.ts`) rather than trusted as free-form text; invitation deep links are parsed and validated, not trusted raw (`src/deepLinks/parseInvitationLink.ts`, `.test.ts`). Corrected 2026-08-13 during Phase 17's traceability sweep. Uploaded-photo content is validated too, closing T23 (`docs/threat-model.md`): `server/import/sniffImageType.ts` checks the real magic-byte signature before `import-recipe/index.ts` calls Anthropic, rather than trusting the upload's declared Content-Type.

SEC-07's correction (`Not Started` → `Done (tested)`) came from the Phase 16 exit review, not this sweep — see [PR #53](https://github.com/kraigstrong/Keepsake/pull/53). SEC-10 stays "In Progress" deliberately — it's the one requirement this phase's own security journey (required journeys list, execution-plan.md) is meant to close, not something to mark done ahead of actually running that journey.

## Delivery Discipline (DEL)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| DEL-01 | Each phase contains coherent incremental commits | Continuous | Process defined (this scaffold) |
| DEL-02 | Each commit is independently understandable | Continuous | Process defined (this scaffold) |
| DEL-03 | Behavior changes include tests | Continuous | Process defined (this scaffold) |
| DEL-04 | Meaningful history is preserved (no squash-everything merges) | Continuous | Process defined (this scaffold) |
| DEL-05 | PRs identify PRD and security implications | Continuous | Template in place (`.github/PULL_REQUEST_TEMPLATE.md`) |
| DEL-06 | Unrelated changes are not mixed into one commit/PR | Continuous | Process defined (this scaffold) |
