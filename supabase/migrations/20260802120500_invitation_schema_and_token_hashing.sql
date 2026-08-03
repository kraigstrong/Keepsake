-- threat-model.md T4: invitation tokens are single-use, expiring, hashed
-- at rest, and validated server-side — this table only ever stores the
-- hash, never the raw token.
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_invitations_household_id
  on public.invitations (household_id);

alter table public.invitations enable row level security;

-- Members can see their household's pending/past invitations (for the
-- settings screen); token_hash is a one-way sha256 digest of a 256-bit
-- random token, so exposing it carries no meaningful risk. No insert/
-- update/delete grant for authenticated — invitations are only ever
-- created and accepted through the RPCs below (ADR-0008).
create policy "Members can select their household's invitations"
  on public.invitations
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.invitations to authenticated;

-- The only way an invitation is created (ADR-0008). Generates the raw
-- token here — server-side, transiently — so it's never persisted or
-- logged in plaintext; only its hash is stored. base64url (RFC 4648 §5,
-- no padding) matches src/deepLinks/parseInvitationLink.ts's existing
-- TOKEN_PATTERN, which already expects this exact shape.
create or replace function public.create_invitation()
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
-- extensions: gen_random_bytes()/digest() (pgcrypto) live there on
-- Supabase, not in public.
set search_path = public, extensions
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

  raw_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.invitations (household_id, invited_by, token_hash, expires_at)
  values (
    caller_household_id,
    auth.uid(),
    encode(digest(raw_token, 'sha256'), 'hex'),
    -- 7 days: long enough to actually reach and be opened by the invited
    -- person, short enough to bound how long a leaked link stays live.
    now() + interval '7 days'
  )
  returning * into new_invitation;

  return query select new_invitation.id, raw_token, new_invitation.expires_at;
end;
$$;

revoke all on function public.create_invitation() from public;
grant execute on function public.create_invitation() to authenticated;
