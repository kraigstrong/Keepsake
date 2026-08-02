-- threat-model.md T4 "abuse controls": bound how many live invitations a
-- household can accumulate and how fast, so a buggy client loop or a
-- compromised member can't mint unbounded tokens. Redefines
-- create_invitation() from the previous migration with two guards added
-- before token generation; everything else is unchanged.
create or replace function public.create_invitation()
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  raw_token text;
  new_invitation public.invitations;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.invitations
    where household_id = caller_household_id
      and accepted_at is null
      and expires_at > now()
  ) >= 5 then
    raise exception 'too many pending invitations for this household' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.invitations
    where household_id = caller_household_id
      and created_at > now() - interval '30 seconds'
  ) then
    raise exception 'please wait before creating another invitation' using errcode = 'P0001';
  end if;

  raw_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.invitations (household_id, invited_by, token_hash, expires_at)
  values (
    caller_household_id,
    auth.uid(),
    encode(digest(raw_token, 'sha256'), 'hex'),
    now() + interval '7 days'
  )
  returning * into new_invitation;

  return query select new_invitation.id, raw_token, new_invitation.expires_at;
end;
$$;
