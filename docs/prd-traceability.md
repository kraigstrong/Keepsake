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
| REC-01 | Title, hero image, active/total time, yield | 4 | Not Started |
| REC-02 | Ingredient sections | 4 | Not Started |
| REC-03 | Instruction sections | 4 | Not Started |
| REC-04 | Permanent notes | 4 | Not Started |
| REC-05 | Cooking history, separate from permanent notes | 15 | Not Started |
| REC-06 | Source URL and attribution | 4 / 8 | Not Started |
| REC-07 | Structured categories and tags on the recipe | 4 | Not Started |
| REC-08 | Version history | 5 | Not Started |
| REC-09 | No recipe description field exists | 4 | Not Started |

## Import (IMP)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| IMP-01 | Website URL import | 8 | Not Started |
| IMP-02 | Safari Share Sheet import | 9 | Not Started |
| IMP-03 | Bulk URL import | 9 | Not Started |
| IMP-04 | Camera import | 10 | Not Started |
| IMP-05 | Existing photo import | 10 | Not Started |
| IMP-06 | Manual creation | 4 | Not Started |
| IMP-07 | No mandatory review step after import | 8 | Not Started |

## AI Responsibilities (AI)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| AI-01 | Remove blog content | 8 | Not Started |
| AI-02 | Rewrite instructions clearly | 8 | Not Started |
| AI-03 | Include ingredient quantities inline | 8 | Not Started |
| AI-04 | Identify sections | 8 | Not Started |
| AI-05 | Infer timing | 8 | Not Started |
| AI-06 | Infer categories and tags | 8 | Not Started |
| AI-07 | Detect and highlight ambiguity | 8 | Not Started |
| AI-08 | Never confidently invent missing information | 8 (cross-cutting) | Not Started |

## Images (IMG)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| IMG-01 | Website recipe images stored locally, never hotlinked | 8 | Not Started |
| IMG-02 | Photo import preserves the original image | 10 | Not Started |
| IMG-03 | Original photo viewable later | 10 | Not Started |
| IMG-04 | Replace / crop-square / remove image | 4 / 10 | Not Started |

## Units and Scaling (UNIT)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| UNIT-01 | Original quantity values are always stored | 11 | Not Started |
| UNIT-02 | Display toggle: Original vs. Preferred (global user preference) | 11 | Not Started |
| UNIT-03 | Only safe conversions are offered | 11 | Not Started |
| UNIT-04 | Scaling presets ½×, 1×, 1½×, 2×, 3×, 4× | 11 | Not Started |
| UNIT-05 | Arbitrary serving count for recipes with servings | 11 | Not Started |
| UNIT-06 | Kitchen-friendly rounding | 11 | Not Started |

## Organization (ORG)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| ORG-01 | Structured categories: Protein / Dish Type / Preparation | 4 | Not Started |
| ORG-02 | Multiple category selections allowed | 4 | Not Started |
| ORG-03 | Free-form tags supported | 4 | Not Started |
| ORG-04 | AI suggests categories and tags | 8 | Not Started |

## Search (SRCH)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| SRCH-01 | Search covers title, ingredients, notes, author, source, categories, tags | 7 | Not Started |
| SRCH-02 | Priority: title \> ingredients \> everything else | 7 | Not Started |
| SRCH-03 | Typo tolerance | 7 | Not Started |
| SRCH-04 | Singular/plural matching | 7 | Not Started |
| SRCH-05 | Results show titles only | 7 | Not Started |

## Library (LIB)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| LIB-01 | Default sort: Recently Added (\<2wk) \> Frequently Selected \> remaining | 7 | Not Started |
| LIB-02 | Additional sorts: Smart / Alphabetical / Recently Added / Frequently Selected | 7 | Not Started |
| LIB-03 | Recipe rows show title only, no metadata clutter | 7 | Not Started |
| LIB-04 | Filters with active filter count | 7 | Not Started |

## This Week / Planning (WEEK)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| WEEK-01 | This Week is the default screen | 2 / 12 | Done (tested) |
| WEEK-02 | Select recipes → choose servings → review → confirm | 12 | Not Started |
| WEEK-03 | Confirming increments planned count | 12 | Not Started |
| WEEK-04 | Cards show image and title | 12 | Not Started |
| WEEK-05 | Drag-to-reorder | 12 | Not Started |
| WEEK-06 | Ordered shortlist, not a meal calendar (no weekday/meal assignment) | 12 | Not Started |
| WEEK-07 | Multi-member synchronization of the shared plan | 12 | Not Started |

## Frequently Selected (FREQ)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| FREQ-01 | Based on planned count, not cooking count | 12 | Not Started |
| FREQ-02 | Archived recipes excluded | 16 | Not Started |

## Cooking Mode (COOK)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| COOK-01 | Single scrolling cooking screen | 15 | Not Started |
| COOK-02 | Keep screen awake | 15 | Not Started |
| COOK-03 | Check off ingredients and instructions | 15 | Not Started |
| COOK-04 | Checklist progress is device-specific | 15 | Not Started |
| COOK-05 | Done Cooking clears progress, records timestamp, optional removal from This Week | 15 | Not Started |
| COOK-06 | Done Cooking prompts for a cooking note | 15 | Not Started |

## Cooking Notes (NOTE)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| NOTE-01 | Short note capture after cooking | 15 | Not Started |
| NOTE-02 | Chronological note history | 15 | Not Started |
| NOTE-03 | Newest note preview near top | 15 | Not Started |
| NOTE-04 | Permanent recipe notes remain a separate concept | 4 / 15 | Not Started |

## Grocery Export (GRO)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| GRO-01 | Grouped review before export | 13 | Not Started |
| GRO-02 | Include/exclude items | 13 | Not Started |
| GRO-03 | Apple Reminders export (only export target for MVP) | 14 | Not Started |
| GRO-04 | Standard categories: Produce / Meat / Frozen / Dairy / Pantry / Other | 13 | Not Started |
| GRO-05 | Conservative ingredient merging, no merge UI | 13 | Not Started |
| GRO-06 | Staples omitted by default | 13 | Not Started |
| GRO-07 | No editing within the export flow | 13 / 14 | Not Started |

## Lifecycle: Archive & Delete (LIFE)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| LIFE-01 | Archive hides a recipe from Library, Search, Planning, Frequently Selected, Recently Added | 16 | Not Started |
| LIFE-02 | Archived Recipes reachable from the overflow menu | 16 | Not Started |
| LIFE-03 | Unarchive | 16 | Not Started |
| LIFE-04 | Delete requires confirmation, moves recipe to Recently Deleted | 16 | Not Started |
| LIFE-05 | Recently Deleted is shared and does not auto-expire in MVP | 16 | Not Started |
| LIFE-06 | Restore from Recently Deleted | 16 | Not Started |
| LIFE-07 | Permanent delete | 16 | Not Started |

## Offline (OFF)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| OFF-01 | Offline browsing | 6 | Not Started |
| OFF-02 | Offline searching | 6 / 7 | Not Started |
| OFF-03 | Offline cooking | 15 | Not Started |
| OFF-04 | Imports, editing, planning, and grocery export require connectivity | 6 (boundary), enforced per feature phase | Not Started |
| OFF-05 | Cooking completion queues locally and syncs on reconnect | 15 | Not Started |

## Version History (VER)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| VER-01 | A version is created only on explicit save | 5 | Not Started |
| VER-02 | Autosaves remain temporary drafts | 5 | Not Started |
| VER-03 | Restore a previous version | 5 | Not Started |
| VER-04 | Restoring creates a new version; later history is preserved | 5 | Not Started |

## Security (SEC)

Cross-cutting per execution-plan.md §2.6 — every phase must address these where relevant; the ID marks where each is primarily concentrated.

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| SEC-01 | No secret is ever committed to Git | Continuous, gated at 0 | Done (tested) |
| SEC-02 | Approved secret management (1Password) is used | 0 | Done (tested) |
| SEC-03 | Household data is protected server-side (RLS) | 3 | Done (tested) |
| SEC-04 | Storage is restricted by membership | 3 | Done (tested) |
| SEC-05 | Sensitive content is excluded from telemetry | Continuous, gated at 2 | Done (tested) |
| SEC-06 | External input is validated | 8 (primary), continuous | Not Started |
| SEC-07 | Destructive operations are authorized and idempotent | 16 (primary), continuous | Not Started |
| SEC-08 | Security scanning runs in CI | 0 | Done (tested) |
| SEC-09 | Dependencies are reviewed and scanned | 0 | Done (tested) |
| SEC-10 | Security is validated in every phase | Continuous | In Progress |

## Delivery Discipline (DEL)

| ID | Requirement | Owning Phase | Status |
|---|---|---|---|
| DEL-01 | Each phase contains coherent incremental commits | Continuous | Process defined (this scaffold) |
| DEL-02 | Each commit is independently understandable | Continuous | Process defined (this scaffold) |
| DEL-03 | Behavior changes include tests | Continuous | Process defined (this scaffold) |
| DEL-04 | Meaningful history is preserved (no squash-everything merges) | Continuous | Process defined (this scaffold) |
| DEL-05 | PRs identify PRD and security implications | Continuous | Template in place (`.github/PULL_REQUEST_TEMPLATE.md`) |
| DEL-06 | Unrelated changes are not mixed into one commit/PR | Continuous | Process defined (this scaffold) |
