-- ADR-0028: deleting an account must be possible, and a departing member's
-- household-visible content must survive it. Fifteen columns reference
-- auth.users with no delete action, so Postgres refuses the parent delete
-- outright; this converts them per the ADR's rule.
--
-- The rule: a column recording who acted on household-shared content
-- detaches (nullable + set null). A row private to one user is deleted
-- outright (stays not null + cascade). recipe_drafts is the only table in
-- this schema whose RLS is per-user (user_id = auth.uid()), so nulling its
-- owner would strand private unfinished writing in a row no policy can
-- match and nothing can remove.

-- Household-shared attribution: detach.
alter table public.recipes alter column created_by drop not null;
alter table public.recipes drop constraint recipes_created_by_fkey,
  add constraint recipes_created_by_fkey foreign key (created_by)
    references auth.users (id) on delete set null;
alter table public.recipes drop constraint recipes_archived_by_fkey,
  add constraint recipes_archived_by_fkey foreign key (archived_by)
    references auth.users (id) on delete set null;
alter table public.recipes drop constraint recipes_deleted_by_fkey,
  add constraint recipes_deleted_by_fkey foreign key (deleted_by)
    references auth.users (id) on delete set null;
alter table public.recipes drop constraint recipes_restored_by_fkey,
  add constraint recipes_restored_by_fkey foreign key (restored_by)
    references auth.users (id) on delete set null;

alter table public.recipe_versions alter column created_by drop not null;
alter table public.recipe_versions drop constraint recipe_versions_created_by_fkey,
  add constraint recipe_versions_created_by_fkey foreign key (created_by)
    references auth.users (id) on delete set null;

alter table public.cooking_events alter column cooked_by drop not null;
alter table public.cooking_events drop constraint cooking_events_cooked_by_fkey,
  add constraint cooking_events_cooked_by_fkey foreign key (cooked_by)
    references auth.users (id) on delete set null;

alter table public.planning_entries alter column added_by drop not null;
alter table public.planning_entries drop constraint planning_entries_added_by_fkey,
  add constraint planning_entries_added_by_fkey foreign key (added_by)
    references auth.users (id) on delete set null;

alter table public.grocery_item_selections alter column updated_by drop not null;
alter table public.grocery_item_selections drop constraint grocery_item_selections_updated_by_fkey,
  add constraint grocery_item_selections_updated_by_fkey foreign key (updated_by)
    references auth.users (id) on delete set null;

alter table public.import_jobs alter column created_by drop not null;
alter table public.import_jobs drop constraint import_jobs_created_by_fkey,
  add constraint import_jobs_created_by_fkey foreign key (created_by)
    references auth.users (id) on delete set null;

alter table public.import_batches alter column created_by drop not null;
alter table public.import_batches drop constraint import_batches_created_by_fkey,
  add constraint import_batches_created_by_fkey foreign key (created_by)
    references auth.users (id) on delete set null;

alter table public.selection_rounds alter column created_by drop not null;
alter table public.selection_rounds drop constraint selection_rounds_created_by_fkey,
  add constraint selection_rounds_created_by_fkey foreign key (created_by)
    references auth.users (id) on delete set null;
alter table public.selection_rounds drop constraint selection_rounds_applied_by_fkey,
  add constraint selection_rounds_applied_by_fkey foreign key (applied_by)
    references auth.users (id) on delete set null;

alter table public.deleted_recipes drop constraint deleted_recipes_deleted_by_fkey,
  add constraint deleted_recipes_deleted_by_fkey foreign key (deleted_by)
    references auth.users (id) on delete set null;

alter table public.invitations drop constraint invitations_accepted_by_fkey,
  add constraint invitations_accepted_by_fkey foreign key (accepted_by)
    references auth.users (id) on delete set null;

-- invited_by cascades today, which would destroy live invitations a
-- departing member had already sent. An invitation is household-visible:
-- the invitee was invited to a household, and the household is still
-- there. Nothing reads the column -- accept_invitation resolves on
-- token_hash/accepted_at/expires_at, and the pending-invitation rate
-- limit counts by household_id.
alter table public.invitations alter column invited_by drop not null;
alter table public.invitations drop constraint invitations_invited_by_fkey,
  add constraint invitations_invited_by_fkey foreign key (invited_by)
    references auth.users (id) on delete set null;

-- Per-user-private: delete outright. Stays not null.
alter table public.recipe_drafts drop constraint recipe_drafts_user_id_fkey,
  add constraint recipe_drafts_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade;

-- Deleting a household must not fail partway: everything else already
-- cascades from households, these two did not.
alter table public.import_jobs drop constraint import_jobs_household_id_fkey,
  add constraint import_jobs_household_id_fkey foreign key (household_id)
    references public.households (id) on delete cascade;
alter table public.import_batches drop constraint import_batches_household_id_fkey,
  add constraint import_batches_household_id_fkey foreign key (household_id)
    references public.households (id) on delete cascade;

-- selection_rounds.created_by is now nullable, and two guards compare it
-- with <>. In SQL `null <> auth.uid()` is null, not true, so an IF on it
-- does not fire -- the creator-only close would silently stop applying
-- the moment a creator deleted their account, letting any member close a
-- round. Closing is the ballot reveal (ADR-0027 decision 2), so that is
-- an authorization bypass, not a cosmetic gap. Both guards become
-- null-safe here rather than in a follow-up, because the nullable column
-- and the predicate that reads it cannot ship apart.
--
-- A round whose creator is gone therefore cannot be closed. It is not
-- stranded: cancel_selection_round is open to any household member and
-- releases the one-non-terminal-round-per-household index. Cancelled
-- ballots stay private permanently, which is the right default when the
-- person who could have authorised the reveal no longer exists.
create or replace function public.close_selection_round(round_id uuid)
returns public.selection_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_round public.selection_rounds;
  result_round public.selection_rounds;
begin
  perform public.resolve_selection_round_deadline(close_selection_round.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into target_round
  from public.selection_rounds
  where id = close_selection_round.round_id
    and household_id = caller_household_id;

  if target_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  if target_round.created_by is distinct from auth.uid() then
    raise exception 'only the round creator may close it' using errcode = 'P0001';
  end if;

  -- Atomic status-guarded UPDATE ... RETURNING (same shape as
  -- finalize_selection_round_candidates/cancel_selection_round).
  -- coalesce(revealed_at, ...), not an overwrite: decision 2a freezes
  -- decisions as of the *first* reveal, so a second close after a
  -- future refill must never push revealed_at forward.
  update public.selection_rounds
  set status = 'ready_for_review',
      closed_at = now(),
      revealed_at = coalesce(revealed_at, now()),
      updated_at = now()
  where id = close_selection_round.round_id
    and household_id = caller_household_id
    and status = 'active'
  returning * into result_round;

  if result_round.id is null then
    raise exception 'selection round is not active' using errcode = 'P0001';
  end if;

  return result_round;
end;
$$;

-- Sweep of the rest of the class, not just the guard above. Making a
-- column nullable changes every predicate that reads it, and three more
-- sites read one of these. Each is fixed here, with the column that
-- causes it, rather than left to be discovered later.

-- 1. accept_invitation. `accepted_by <> auth.uid()` is null when the
-- accepter has deleted their account, so `accepted_at is not null and
-- null` is null, the already-used guard does not fire, and the function
-- falls through to returning the household row of a household the caller
-- is not a member of. A spent token replayed by anyone else would hand
-- back another household's row and report success while creating no
-- membership. The client then treats the token as spent and clears it.
create or replace function public.accept_invitation(raw_token text)
returns public.households
language plpgsql
security definer
-- extensions: digest() (pgcrypto) lives there on Supabase, not in public.
set search_path = public, extensions
as $$
declare
  computed_hash text := encode(digest(raw_token, 'sha256'), 'hex');
  invitation public.invitations;
  result_household public.households;
begin
  select * into invitation from public.invitations where token_hash = computed_hash for update;

  if invitation.id is null then
    raise exception 'invalid invitation token' using errcode = 'P0001';
  end if;

  -- is distinct from, not <>: accepted_by detaches on account deletion.
  if invitation.accepted_at is not null
     and invitation.accepted_by is distinct from auth.uid() then
    raise exception 'invitation has already been used' using errcode = 'P0001';
  end if;

  if invitation.accepted_at is null then
    if invitation.expires_at <= now() then
      raise exception 'invitation has expired' using errcode = 'P0001';
    end if;

    if exists (select 1 from public.household_membership where user_id = auth.uid()) then
      raise exception 'user already belongs to a household' using errcode = 'P0001';
    end if;

    insert into public.household_membership (household_id, user_id)
    values (invitation.household_id, auth.uid());

    update public.invitations
    set accepted_at = now(), accepted_by = auth.uid()
    where id = invitation.id;
  end if;
  -- else: already accepted by this same caller — fall through and
  -- return their household again without re-inserting membership.

  select * into result_household from public.households where id = invitation.household_id;
  return result_household;
end;
$$;

-- 2. archive_recipe and delete_recipe pair coalesce(archived_at, now())
-- with coalesce(archived_by, auth.uid()) to stay idempotent. Once the
-- actor detaches, that pairing breaks: the timestamp is set, the actor is
-- null, and the next idempotent call records whoever made it as having
-- performed the original action. The actor now keys off whether the
-- *action* is new rather than whether the column is populated, so a
-- missing actor on a completed action stays missing.
create or replace function public.archive_recipe(recipe_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_recipe public.recipes;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.recipes
  set archived_at = coalesce(archived_at, now()),
      archived_by = case when archived_at is null then auth.uid() else archived_by end,
      updated_at = now()
  where id = recipe_id and household_id = caller_household_id and deleted_at is null
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

create or replace function public.delete_recipe(recipe_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_recipe public.recipes;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.recipes
  set deleted_at = coalesce(deleted_at, now()),
      deleted_by = case when deleted_at is null then auth.uid() else deleted_by end,
      updated_at = now()
  where id = recipe_id and household_id = caller_household_id
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

-- 3. create_selection_round's adoption guard reads created_by with <>
-- too, and is deliberately left alone. With a detached creator the
-- predicate is null, the guard does not fire, and the pending round is
-- adopted -- which is the behaviour that should happen: a round whose
-- creator no longer exists must not block the household. Rewriting 133
-- lines of concurrency-sensitive code to make a correct outcome explicit
-- risks more than it buys, so the behaviour is pinned by test instead
-- (attribution_detaches.test.sql). Anyone tempted to "fix" it
-- to `is distinct from` will fail that test, which is the point.
