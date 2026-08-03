# ADR-0010: Recipe data model

- **Status:** Accepted
- **Date:** 2026-08-03
- **Phase:** 4

## Context

Phase 4 needs a real recipe schema before any of manual creation, the editor, or Recipe Detail can be built. prd.md §7 names the recipe model's fields (title, hero image, active/total time, yield, ingredient sections, instruction sections, permanent notes, cooking history, source URL/attribution, structured categories, tags, version history) but doesn't specify table shapes — several genuine schema decisions need to be made before writing the migration:

1. Are ingredient/instruction sections a shared "sections" concept, or two separate ones?
2. How structured should an ingredient/instruction line be — just text, or quantity/unit/name broken out?
3. Categories are "structured" (prd.md §12: three fixed groups — Protein, Dish Type, Preparation) while tags are explicitly "free-form" (prd.md §7) — how does that difference show up in the schema?
4. prd.md §12's example category values (e.g. "Soup, Pasta, Dessert" for Dish Type) read as illustrative, not exhaustive — nothing in the PRD gives a complete list.

## Decision

**Ingredient sections and instruction sections are separate concepts, each its own table pair** (`recipe_ingredient_sections`/`recipe_ingredients`, `recipe_instruction_sections`/`recipe_instructions`) — matching prd.md §7 listing them as two distinct fields (REC-02, REC-03), not one shared "sections" table. A recipe with no explicit sections still gets one default (untitled) section per list, so the UI never needs to special-case "no sections."

**Ingredients and instructions are plain text lines for now**, not structured quantity/unit/ingredient-name fields. Phase 11 ("Units, Scaling, and Quantity Integrity") is where real structured quantity parsing belongs — building that machinery now, before Phase 11 has decided its actual shape, would mean redoing it later. Matches prd.md §9's "include ingredient quantities inline" framing (quantities live in the text, not a separate field) even though Phase 4 has no AI — a person typing "2 lb baby potatoes, halved" manually is the same shape either way.

**Categories are a seeded, extensible lookup table** (`categories`: `group_name` constrained to `protein`/`dish_type`/`preparation`, `value` text, unique per group+value) joined via `recipe_categories`, not a Postgres enum or a bare `text[]`. Seeded with prd.md §12's example values per group. A lookup table keeps the door open for adding more values later via a plain migration (a real need — three Dish Type examples obviously isn't a complete taxonomy) without an enum-alteration migration, while still keeping categories genuinely structured (a fixed vocabulary, not free text) for Phase 7's filter UI to key off later.

**Tags are a plain `text[]` column on `recipes`**, not a separate table. Free-form per prd.md §7, no identity or metadata of their own (unlike categories, which need group membership) — a table + join would be pure overhead for what's fundamentally a list of strings. Revisit only if Phase 7's search/filter needs tag autocomplete or tag-level analytics that a plain array can't support.

**No versioning, drafts, or conflict handling** — Phase 5's job entirely (prd.md's own phase split). The recipe save RPC is a single atomic write; there's no `recipe_versions` table, no draft persistence, no base-version check. "Explicit Save" in Phase 4's build scope means the UI doesn't autosave to the server, not that a draft-versioning system exists yet.

**No AI, no import parsing** — Phase 8+'s job. Recipes are typed by hand this phase.

**Reuses Phase 3's `recipe-images` Storage bucket and `<household_id>/...` path convention** (already built, ahead of need, in ADR-0008/threat-model.md T4's Storage-isolation work) rather than inventing a new bucket or path scheme.

## Alternatives considered

- **One shared `recipe_sections` table with a `kind` discriminator (ingredient/instruction):** rejected — ingredients and instructions have different child-row shapes (ingredient line vs. numbered step), and prd.md already treats them as two separate requirements; a shared parent table buys nothing here and would need `kind`-branching everywhere it's queried.
- **Structured ingredient quantity/unit/name columns now:** rejected — Phase 11 owns "safe conversions," "kitchen-friendly rounding," and the ½×–4× scaling model (prd.md §11); building a structured shape ahead of that phase's own design risks a schema rewrite instead of an addition.
- **Postgres enum for categories:** rejected — enums need `ALTER TYPE` migrations to add a value, which is real friction for a taxonomy prd.md itself doesn't give a complete list for. A lookup table is just as structured but adds values with a plain `INSERT`.
- **Categories as `text[]` like tags:** rejected — categories need group membership (which of Protein/Dish Type/Preparation a value belongs to) for Phase 7's grouped filter sheet; a flat array loses that structure.

## Consequences

- Phase 7 (Library, Smart Sort, Search, and Filters) builds its filter sheet against `categories`/`recipe_categories` directly — the group/value shape is already there.
- Phase 11 replacing plain-text ingredient lines with structured quantity/unit fields is a real, expected future migration, not a sign this phase's design was wrong — flagged here so it isn't a surprise.
- Growing the `categories` seed list (e.g. more Dish Type values) is a plain forward-only migration, no schema change.
- The recipe save RPC follows the same SECURITY DEFINER + re-derive-household-from-caller pattern as Phase 3's `create_household`/`create_invitation` (ADR-0008) — no new server-operation pattern introduced.
