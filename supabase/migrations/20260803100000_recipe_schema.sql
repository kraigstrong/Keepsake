-- Phase 4 recipe model (prd.md §7, ADR-0010). household_id is denormalized
-- onto every table here (not just recipes) so every RLS policy can use
-- the same is_household_member(household_id) shape already established
-- in Phase 3, rather than nested subqueries through recipes for the
-- child tables — a recipe's household never changes post-creation
-- (ADR-0004: no membership transfer), so this redundancy is safe.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  -- Storage object path within the recipe-images bucket (Phase 3,
  -- ADR-0008), "<household_id>/..." convention. Null until an image is
  -- uploaded.
  hero_image_path text,
  active_time_minutes integer,
  total_time_minutes integer,
  -- Free text, not numeric — prd.md §7's "Yield" covers both serving
  -- counts ("Serves 4") and non-serving yields ("12 cookies").
  yield_text text,
  permanent_notes text,
  source_url text,
  source_attribution text,
  tags text[] not null default '{}',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recipes_household_id on public.recipes (household_id);

create table if not exists public.recipe_ingredient_sections (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  -- Null title = an unheaded default section (most recipes have one).
  title text,
  sort_order integer not null default 0
);

create index if not exists idx_recipe_ingredient_sections_recipe_id
  on public.recipe_ingredient_sections (recipe_id);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.recipe_ingredient_sections (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  -- Plain text line ("2 lb baby potatoes, halved") — no structured
  -- quantity/unit/name yet, that's Phase 11 (ADR-0010).
  line_text text not null check (char_length(trim(line_text)) > 0),
  sort_order integer not null default 0
);

create index if not exists idx_recipe_ingredients_section_id
  on public.recipe_ingredients (section_id);

create table if not exists public.recipe_instruction_sections (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  title text,
  sort_order integer not null default 0
);

create index if not exists idx_recipe_instruction_sections_recipe_id
  on public.recipe_instruction_sections (recipe_id);

create table if not exists public.recipe_instructions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.recipe_instruction_sections (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  line_text text not null check (char_length(trim(line_text)) > 0),
  sort_order integer not null default 0
);

create index if not exists idx_recipe_instructions_section_id
  on public.recipe_instructions (section_id);

-- Global shared taxonomy (prd.md §12), not household-scoped — every
-- household sees and picks from the same category list. Seeded below
-- with the PRD's example values per group; growing the list later is a
-- plain migration (ADR-0010 — this is deliberately not an enum).
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  group_name text not null check (group_name in ('protein', 'dish_type', 'preparation')),
  value text not null,
  unique (group_name, value)
);

insert into public.categories (group_name, value) values
  ('protein', 'Chicken'),
  ('protein', 'Beef'),
  ('protein', 'Pork'),
  ('protein', 'Seafood'),
  ('protein', 'Vegetarian'),
  ('dish_type', 'Soup'),
  ('dish_type', 'Pasta'),
  ('dish_type', 'Dessert'),
  ('preparation', 'Grill'),
  ('preparation', 'Slow Cooker'),
  ('preparation', 'Air Fryer')
on conflict (group_name, value) do nothing;

create table if not exists public.recipe_categories (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  primary key (recipe_id, category_id)
);

create index if not exists idx_recipe_categories_recipe_id
  on public.recipe_categories (recipe_id);

alter table public.recipes enable row level security;
alter table public.recipe_ingredient_sections enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_instruction_sections enable row level security;
alter table public.recipe_instructions enable row level security;
alter table public.categories enable row level security;
alter table public.recipe_categories enable row level security;
