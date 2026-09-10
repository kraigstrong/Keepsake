-- The schema-wide half of "writes are RPC-only" (20260909120000).
--
-- The per-table tests assert this one table at a time, by attempting a
-- write as `authenticated` and expecting a refusal. They pass whether
-- the refusal comes from a missing grant or from RLS, so they cannot
-- tell the two layers apart — which is how the grant layer went missing
-- on a hosted project without any test noticing. These assertions read
-- the catalog directly, so they fail if the grant layer alone erodes.
--
-- The default-privileges assertion is the one that survives new tables:
-- a table added by a later migration inherits from `pg_default_acl`, so
-- it is locked down before anyone remembers to write a test for it.

begin;

select plan(3);

-- 1. No client role holds a write grant on any table in `public`, with
-- one intentional exception handled in the next assertion.
select is_empty(
  $$
    select grantee, table_name, privilege_type
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and not (grantee = 'authenticated'
                and table_name = 'profiles'
                and privilege_type in ('INSERT', 'UPDATE'))
  $$,
  'no client write grants in public beyond the profiles exception'
);

-- 2. The exception is exactly insert+update on profiles, and never
-- delete — account removal goes through prepare_account_deletion().
select set_eq(
  $$
    select privilege_type::text
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'profiles'
       and grantee = 'authenticated'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  $$,
  array['INSERT', 'UPDATE'],
  'profiles grants authenticated insert and update, but not delete'
);

-- 3. Default privileges carry the invariant forward. `postgres` is the
-- role migrations run as, so this is what a table created by a future
-- migration inherits.
select is_empty(
  $$
    select 1
      from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole
       and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = 'r'
       and a.grantee::regrole::text in ('anon', 'authenticated')
       and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  $$,
  'public default privileges grant no writes to anon or authenticated'
);

select * from finish();

rollback;
