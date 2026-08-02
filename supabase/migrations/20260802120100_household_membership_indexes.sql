-- household_membership's own PK/unique(user_id) don't index household_id,
-- which every "list my household's members" query filters on.
create index if not exists idx_household_membership_household_id
  on public.household_membership (household_id);
