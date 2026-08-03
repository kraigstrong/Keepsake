-- User-specific draft storage (prd.md §26 RecipeDraft, ADR-0011) — the
-- one table in this schema where RLS enforces per-user ownership
-- rather than household membership: drafts are explicitly not shared
-- with the rest of the household. recipe_id is nullable because a
-- draft can exist for a not-yet-created recipe (the new-recipe form).
-- household_id is still denormalized here (not for visibility — that's
-- user_id's job — but so upsert_draft/delete_draft can re-derive it the
-- same way every other write in this schema does, rather than trusting
-- a client-supplied value).

create table if not exists public.recipe_drafts (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references public.recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  household_id uuid not null references public.households (id) on delete cascade,
  draft_payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- Two partial unique indexes, not one table-level constraint, because
-- Postgres treats every null as distinct: a plain unique(user_id,
-- recipe_id) would let a user accumulate unlimited "new recipe" drafts
-- (recipe_id is null for those) without ever violating it. This caps
-- it at one draft per user per existing recipe, and one new-recipe
-- draft per user.
create unique index if not exists idx_recipe_drafts_user_recipe
  on public.recipe_drafts (user_id, recipe_id) where recipe_id is not null;

create unique index if not exists idx_recipe_drafts_user_new_recipe
  on public.recipe_drafts (user_id) where recipe_id is null;

alter table public.recipe_drafts enable row level security;

create policy "Users can select their own drafts"
  on public.recipe_drafts
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.recipe_drafts to authenticated;

-- No insert/update/delete grant for authenticated — writes only go
-- through upsert_draft/delete_draft (next migration), both SECURITY
-- DEFINER, so household_id and user_id are always caller-derived, never
-- client-supplied (ADR-0008's rule, applied here too).
