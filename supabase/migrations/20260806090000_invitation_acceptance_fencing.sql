-- ADR-0020 (Phase 11.5): accept_invitation (ADR-0008, Phase 3, already
-- shipped) is a read-check-then-write race. Two different users racing
-- the same token could both observe accepted_at is null before either
-- writes -- a "single-use" invitation wasn't actually single-use under
-- concurrency. Forward-only fix (this function has already reached
-- staging): re-create with `for update` added to the initial select,
-- everything else unchanged. Locking the invitation row here serializes
-- concurrent callers on that specific token -- a second caller now
-- blocks until the first transaction commits, then correctly falls
-- into the existing "already used" branch instead of racing past it.
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

  if invitation.accepted_at is not null and invitation.accepted_by <> auth.uid() then
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

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
