# ADR-0028: Account deletion, attribution survival, and the one service-role exception

- **Status:** Proposed
- **Date:** 2026-09-03
- **Phase:** Milestone 5 — Friends & Family Preview

## Context

Keepsake has no way for a user to delete their account. Issue #166 is the implementation; this ADR settles the parts of it that would take a migration or a security redesign to reverse.

The forcing function is Apple Guideline 5.1.1(v): an app offering account creation must offer in-app account deletion. That makes deletion a hard gate on a public listing and the likely contingency if Beta App Review raises it against the external TestFlight build. So this ships inside Milestone 5, not after it.

Four constraints shape every option:

**There is no owner.** `public.households` is `id` and `created_at` and nothing else (`supabase/migrations/20260802120000_household_and_membership_schema.sql:17`). `household_membership` carries no `role` column (`:27`), `docs/prd.md:149` says "All members have equal permissions," and ADR-0027 decision 3 records that even that feature's creator-only close was a deliberate, noted-as-inconsistent exception. So there is no member who can be said to hold the shared library, and no member who can authorise destroying it on the others' behalf. That is a product fact before it is an engineering one, and it decides the shape of everything below.

**Fifteen foreign-key columns across eleven tables currently make deleting an `auth.users` row impossible.** They are plain `references auth.users (id)` with no delete action, so Postgres refuses the parent delete outright: `recipes.created_by`/`archived_by`/`deleted_by`/`restored_by`, `recipe_versions.created_by`, `import_jobs.created_by`, `import_batches.created_by`, `selection_rounds.created_by`/`applied_by`, `cooking_events.cooked_by`, `planning_entries.added_by`, `grocery_item_selections.updated_by`, `recipe_drafts.user_id`, `invitations.accepted_by`, `deleted_recipes.deleted_by`. Nine of those are `NOT NULL`. Five columns already cascade (`profiles.id`, `household_membership.user_id`, `selection_decisions.user_id`, `selection_round_participants.user_id`, `invitations.invited_by`). Issue #166 says "eleven foreign keys" — that is the count of *tables*, and its `NOT NULL` list omits `grocery_item_selections.updated_by` and `recipe_drafts.user_id`, both of which are `not null`. A migration built from that list would pass review and then fail at the first delete against a household that has ever ticked a grocery item.

**Nothing in this runtime can touch `auth.users`.** `service_role` appears in zero migrations and zero lines of application code — the only occurrence anywhere in `supabase/` is a comment in `config.toml`. `AGENTS.md:28` states the invariant: "The Edge Function uses the caller's JWT, not the service-role key. A PR that introduces service-role access into a request path a client can trigger is a hard stop." `docs/architecture.md:22` says the same thing, and `docs/threat-model.md`'s T15 entry reasons *from* it ("this app's runtime never holds the service-role key … so a bucket-wide scheduled sweep would have been new infrastructure"). Deleting an `auth.users` row is the one operation this app needs that no amount of RLS design can reach.

**Storage is keyed by household, and permission is membership.** Every policy in `20260802120800_recipe_images_storage.sql` gates on `is_household_member(safe_uuid((storage.foldername(name))[1]))`. The instant the caller's membership row is gone, the caller loses the right to delete their own household's objects.

Three decisions were taken by the developer before this ADR and are recorded, not re-argued: keep a departing member's content and blank the attribution; delete the `auth.users` row from a narrowly-scoped service-role Edge Function; delete immediately behind a typed confirmation, with no grace period. This ADR exists mainly for the second one.

## Decision

### 1. A departing member's household content survives; only the attribution goes

Recipes, versions, cooking history, plan entries, grocery selections and import history stay in the household. The fifteen blocking columns become `ON DELETE SET NULL`, and the nine `NOT NULL` constraints on them are dropped.

The reasoning is the no-owner fact above. In a two-person household, deleting the leaver's recipes guts a library the other person reasonably considers half theirs, and there is no role in the schema that could arbitrate that. Absent an owner, the only defensible default is that shared content stays shared.

**The boundary of "content" is household visibility, not who typed it.** `recipe_drafts` is the one table in this schema whose RLS enforces per-user ownership rather than household membership — its own migration header says so, and its select policy is `user_id = auth.uid()` (`supabase/migrations/20260804090100_recipe_drafts_schema.sql:1-9, 34-38`). Nulling `user_id` there would leave a row that no policy can ever match again (`null = auth.uid()` is never true), holding the departed user's private unfinished writing, invisible to every application path and removable by none. `recipe_drafts.user_id` therefore gets `ON DELETE CASCADE`, not `SET NULL`. The repo already has this instinct: `selection_decisions.user_id` and `selection_round_participants.user_id` — the other per-user-private rows, ADR-0027 decision 2's blind ballots — already cascade. The rule is *per-user-private rows are deleted, household-shared rows keep their content and lose their attribution*, and #166's flat "eleven columns become SET NULL" gets it wrong for exactly the one table where the two categories differ.

### 2. Attribution becomes absent, not a sentinel identity

A "Former member" placeholder was the obvious alternative and is rejected. `profiles.id references auth.users (id)` (`20260802120000:9`), so a sentinel profile requires a real `auth.users` row: a permanent never-deleted account with a real email address, created by whatever mechanism this ADR is otherwise trying to avoid, and reachable by anyone who can send a magic link to that address. It also makes the data lie rather than fall silent — every departed member collapses into one identity, so two different people's recipes render as authored by the same person, and a null renders as "no author" which is true.

Null must therefore be a *rendered* state, not a crash. `fetchHouseholdMembers` (`src/household/api.ts:127`) resolves display names by joining `household_membership` to `profiles`, so a null `created_by` simply fails to resolve — the requirement is that every call site treats an unresolved actor as "no name shown," never as `undefined` in a string.

### 3. Sole member versus shared member is derived server-side, under a lock, twice

Which of the two operations runs — destroy the household, or remove one person from it — is decided from the membership count inside the deleting transaction, after `select id from public.households where id = <caller's household> for update`.

Client state cannot be trusted here for the ordinary reason (a client can lie) and for a specific one: the client's member list is a cached read, and this is the single most irreversible operation in the app. A stale "I am the only member" belief destroys another person's entire library. That belief is the *whole* authorization argument for the destruction — with no owner and no role, "nobody else is in this household" is the only thing that makes it legitimate — so it has to be established by the same transaction that acts on it.

**The lock is load-bearing, and the race is real rather than theoretical.** `accept_invitation` takes `for update` on the *invitation* row (`20260806090000_invitation_acceptance_fencing.sql:23`, ADR-0020 decision 1) and touches nothing else, so an acceptance and a deletion serialize only on whatever incidental locks the `household_membership` foreign key happens to take. A sole member with an outstanding invitation who deletes their account at the moment the invitee taps the link is the case: without an explicit lock on the household row taken *before* the count, the count and the delete can straddle the acceptance. Locking the household row first makes "is anyone else here" and "destroy this household" one indivisible observation.

The flow needs the answer twice, and the two answers have different jobs. A read-only `prepare` call reports the case so R7's confirmation screen can say plainly which one applies — a sole member is told the whole library goes, a shared member is told the household's recipes stay and only their own account does not. That answer is advisory. The authoritative one is re-derived under the lock, and the prepared answer is passed back in as a fence, the same shape as ADR-0020's `claim_token`: if the household went from sole to shared between the two, the RPC aborts loudly rather than acting on the stale reading. This is ADR-0008's "re-derive server-side, never trust a client-supplied id" and ADR-0027 decision 5's "the Edge Function is not a trust boundary; the RPC is," applied to a boolean instead of a UUID.

### 4. Ordering: Storage sweep, then the data transaction, then the auth row

**Storage is swept first, client-side, with the caller's own JWT, and only in the sole-member case.** This reuses ADR-0025 decision 4's mechanism unchanged — `supabase.storage.from('recipe-images').remove([...])` under the existing per-household-prefix policy — rather than introducing a server-side Storage call. It must precede the data transaction because the policies gate on `is_household_member`, and the transaction is what makes that false. In the shared-member case there is no sweep at all: the images belong to the household, and the household survives.

A failed sweep aborts before anything is mutated, so the account is untouched and the whole flow is retryable from the start. That is #166 R4's "fails loudly and is retryable" branch, chosen over its "record the orphans for a later sweep" branch because nothing in this stack schedules work — the same reasoning that rules out a grace period rules out a sweeper to consume such a record.

**What the sweep is actually for is cost and hygiene, not confidentiality.** Once the `households` row is gone, `is_household_member(<that id>)` is false for every user forever and the id is a `gen_random_uuid()` that will not recur, so an orphaned object is unreachable through the app by anyone. Saying this plainly matters, because it is what makes best-effort acceptable here where it would not be for a data-exposure gap. The objects do remain in the project's Storage until removed by someone with project-level access; "deleted" in the user-facing sense means unreachable through every application path, and the sweep is what also makes it true of the bytes.

**One residual, named rather than hidden:** if an invitation is accepted between the sweep and the fenced RPC, the RPC correctly aborts and the household survives — with its hero images and original photos already swept. Recipes, plans and history are intact; the images are not. The window is the length of a typed confirmation, the outcome is recoverable by re-uploading, and closing it properly would mean holding a Storage-wide lock this system has no way to express.

### 5. The data half is one `security definer` RPC, and its postcondition is idempotent

`delete_own_account` performs the whole data deletion in one transaction: lock and count, check the fence, delete `import_jobs`/`import_batches` for the household (their `household_id` foreign keys carry no delete action — `20260805100000_import_jobs_schema.sql:11`, `20260805110000_import_batches_schema.sql:9` — so the `households` delete would otherwise fail partway through), delete the household in the sole case, delete the caller's `recipe_drafts`, delete the membership row. Partial failure rolls back to an intact, usable account. This is ADR-0020 decision 2's shape: merge the steps into one function rather than sequencing several RPCs from the client.

**Its precondition is not "the caller has a household."** A caller with no membership row is not an error — it is someone whose previous attempt got this far and no further. The function's contract is a postcondition ("when this returns, the caller's data is gone"), so every step is written to be a no-op on an already-empty state. Writing it as a precondition check instead is the specific bug that turns a recoverable half-deletion into a permanent one.

`profiles` is deliberately *not* deleted by this RPC. Its `on delete cascade` on `auth.users` removes it in step 6, which keeps the profile row alive as the marker of an incomplete deletion — see decision 6.

### 6. A dedicated Edge Function deletes the `auth.users` row with the service-role key — the one exception

**The exception, stated as narrowly as it can be stated:** exactly one Edge Function may construct a service-role Supabase client, and the only call it may make with that client is `auth.admin.deleteUser(id)` where `id` was obtained by verifying the caller's own JWT. It reads no request body. It takes no user-id parameter. It performs no other privileged operation. Every other Supabase interaction in that function, including the call to `delete_own_account`, uses the caller's JWT exactly like `import-recipe` does.

**Why `auth.uid()`-only scope is what makes it safe.** The danger in an elevated credential is not that it is powerful; it is that it is *steerable*. The service-role key bypasses RLS, so the security of any code holding it reduces to the question of where its operands come from. Here there is exactly one operand and it is not caller-supplied: the user id is read from the verified JWT, which the caller cannot forge without the project's JWT secret. A caller who submits another user's id submits it into a function that never reads a body. A caller who wants to delete someone else's account has to become them first, at which point they did not need this function.

That argument holds only if the id genuinely comes from a *verified* token. The failure mode to name concretely: base64-decoding the JWT payload to read `sub` without verifying the signature turns this function into `deleteUser(anyone)`, because the token is entirely under the caller's control. The id must come from `supabase.auth.getUser()` on a caller-JWT client — which validates against the auth server — with the platform's `verify_jwt` left at its default. `supabase/config.toml` has no `[functions.*]` block today, so that default currently applies to every function; deploying this one with `--no-verify-jwt` would remove the outer half of the check.

**What must be true of the implementation for the exception to hold** — these are the review criteria, not general advice:

- No user id, email, or account selector in the request body or query string. The handler should not parse a body at all.
- The privileged client is constructed inside the one code path that deletes the auth row, and the service-role key is read at exactly one place in the file.
- The function does one thing. No "and also clean up X" — every additional privileged operation is a new operand and a new place to get the provenance wrong.
- `delete_own_account` is called with the caller's JWT, so RLS and `auth.uid()` still govern the data half. The privileged step happens after that transaction has committed, never before and never around it.
- A test attempts the deletion with a mismatched id supplied every way the function could conceivably accept one, and proves the function has no parameter to accept it through.

**What this does not license.** It is not a general admin path, and no second privileged operation may be added to this function. It is not a "delete any user" capability. It is not precedent for service-role elsewhere: `import-recipe` stays JWT-only, and `docs/threat-model.md`'s T15 reasoning — that a server-side Storage sweep was ruled out because the runtime holds no service-role key — is **not** reopened by this ADR, because the runtime still does not, in any path except this one. `AGENTS.md:28` should be amended to name this exception explicitly rather than softened into a guideline; the invariant's value is that it is a hard stop with one written-down hole, not that it is advice.

**One uncomfortable fact worth recording**, because it changes what the invariant has always meant: Supabase injects `SUPABASE_SERVICE_ROLE_KEY` into every deployed Edge Function's environment automatically. The key has therefore been reachable from `import-recipe`'s process the entire time; the invariant was never platform-enforced, only review-enforced. This ADR adds no new secret and no new secret-distribution problem — it permits one new *use* of a credential that was always present. The practical consequence is that the boundary needs a mechanical guard rather than reviewer memory: a check in the same family as `scripts/check-no-server-secrets-in-client.mjs`, asserting that no Edge Function source other than the deletion function mentions the service-role key.

**Why nothing else can delete the auth row** is covered under Alternatives. The short version is that Supabase exposes no self-service delete in the user-facing auth API, and every other route either needs the same or greater privilege or takes a dependency on the internal `auth` schema.

### 7. The window between the data delete and the auth delete is closed by the surviving profile row

If decision 5 commits and decision 6 fails, the account is data-empty and still signs in. #166 R6 requires that state to be recoverable by re-running the deletion. As the app is built today it is not reachable: `app/onboarding.tsx:30` routes any signed-in user with no profile straight to "what should we call you?", and Settings — where the delete entry point lives — is not reachable from there. A user in the half-deleted state would sign in and be shown the new-user onboarding screen with no path back to finishing.

Worse, the app cannot safely *infer* the state. "Signed in, no household" is also every partially-onboarded new user, and auto-completing a deletion on that signal would delete real accounts that had merely not finished signing up.

So the marker is explicit and server-side: the profile row survives the data transaction, carrying a `deletion_requested_at` timestamp, and is removed by its existing `on delete cascade` when the auth row goes. A non-null `deletion_requested_at` observed at sign-in is unambiguous — no new user can produce it — and the client re-invokes the Edge Function on seeing it, before rendering any onboarding UI. The retry needs no user-visible entry point, no new table, and no heuristic. The whole flow is then idempotent end to end: sweep (already empty), RPC (already no-op by decision 5's postcondition contract), auth delete (the only step with work left).

The intermediate state is also survivable if the retry is delayed: a `created_by` pointing at a user with a `deletion_requested_at` profile and no membership resolves to no display name through the same path decision 2 already requires to tolerate null.

### 8. Local data: both outboxes go

`wipeDatabase` (`src/db/database.ts:75-96`) clears a named list of mirror tables and deliberately excludes `import_outbox` *and* `cooking_event_outbox` (`src/db/database.ts:82-85`) — an unsent capture is the only copy of itself until the server confirms it. #166 R8 names only the import outbox; there are two, and both hold rows stamped with a `household_id` the user will no longer have access to, so both would retry forever against a household they can no longer write to. Account deletion is the one case where the survive-sign-out exception does not apply, and the deletion path clears both. This does not change ordinary sign-out.

## Alternatives considered

**A `security definer` function that deletes from `auth.users` directly, with no Edge Function and no service-role key.** The most attractive alternative by a distance: it needs no elevated credential at all, and it would make the entire deletion — data and auth row — a single transaction, dissolving decisions 5 and 7 completely. Rejected on three grounds. It takes a hard dependency on the internal `auth` schema, which Supabase documents as not a stable API and asks projects not to write to, so the privileges it relies on can change under a platform upgrade with no notice and no migration; the failure is silent, discovered by a user who cannot delete their account, on a path that is an App Store compliance obligation. It plants a permanent, ambient DELETE-on-`auth.users` capability inside the database, callable by any authenticated role, whose review surface is every future migration rather than one file. And it is strictly harder to bound than the Edge Function: a `security definer` body can be edited to do anything, whereas the exception in decision 6 is a single deployed source file whose entire privileged surface is one call with one operand. If Supabase ever ships a supported self-delete endpoint, this ADR's exception should be withdrawn in favour of it — that is the good kind of reversibility, and the reason the exception is written narrowly enough to be removable.

**Calling the GoTrue admin API from Postgres via `pg_net`.** Rejected for ADR-0025's stated reason ("this app has never given Postgres outbound HTTP capability, and introducing it for one cleanup call is disproportionate") and for a worse one specific to this case: it would require storing the service-role key inside the database. A secret at rest in the data store, readable by anything that can read the config it lives in, is a strictly worse posture than one in a function's process environment.

**Leaving the `auth.users` row and deleting only the data.** Rejected: an account that still signs in has not been deleted, which is what Guideline 5.1.1(v) is about, and it is also not what a user asking to delete their account means. It would additionally leave that user landing on new-user onboarding forever, since decision 7's marker would never be consumed.

**A sentinel "former member" identity instead of null attribution.** Covered in decision 2. Rejected because it needs a real auth row, and because it makes the data assert something false rather than say nothing.

**A grace period with a scheduled hard-delete.** Rejected, per the developer's decision 3 and its own reasoning: nothing in this stack schedules work, so a recoverable window would be the first background-job infrastructure in the codebase, bought to make an irreversible action feel less irreversible when a typed confirmation already does that job. ADR-0027 decision 4 reached the same conclusion about round auto-close and resolved it lazily; there is no lazy equivalent for "delete this account in 30 days if nobody objects."

**A general "leave household" feature.** Explicitly not built. ADR-0004 cut departure from MVP because "what does this user see next" was unanswered, and that question is still unanswered — this ADR only avoids it because the answer for a deleting user is "nothing; they are gone." Deleting your account while in a shared household is nonetheless the leave path in effect, and the honest consequence is recorded below.

**Recording orphaned Storage objects for a later sweep instead of failing the deletion.** Rejected as decision 4 describes: it requires a sweeper that this stack has no way to run, and the orphans it would record are unreachable rather than exposed, so the record would exist purely for a cleanup that never happens.

**Deciding sole-versus-shared once, at prepare time.** Rejected. The prepared answer has to exist for the confirmation copy to be honest, but acting on it is acting on a reading taken before the transaction that destroys a library. The fence in decision 3 costs one parameter and converts a silent wrong-branch into a loud abort.

## Consequences

**Easier.** Apple's deletion requirement stops being a blocker on the external TestFlight build and on any later listing. The fifteen `SET NULL` conversions make attribution structurally optional, which removes a whole class of future migration pain — any later reason to detach a user from their traces is now a delete, not a schema change. The one-RPC shape means the data half has no partial-failure state to reason about, and decision 7's marker makes the only genuinely multi-commit step self-healing without a retry queue.

**Harder.** Every read path that renders an actor must now tolerate null, forever, including paths written before this ADR and paths written by anyone who has not read it — that is a permanent tax on new features that display a name, and it needs test coverage rather than reviewer vigilance. `AGENTS.md`'s service-role rule stops being a rule with no exceptions, which is measurably weaker than a rule with none: the mechanical check proposed in decision 6 is what keeps the exception from eroding, and without it the invariant degrades into a convention within a release or two.

**The leave path exists now, badly.** ADR-0004 excluded household departure, and this ships the only exit that exists: delete your account, sign up again. That is the workaround for a mis-ordered join — the trap #157's onboarding state machine was written to prevent — and it costs the user their attribution on everything they contributed, since the FK nulls fire on the way out and nothing re-attaches them. It should be documented as what it is rather than presented as a feature, and if it starts getting used as one, that is the signal that ADR-0004 needs revisiting properly.

**Security and credentials.** One new privileged path, bounded as decision 6 specifies, and no new secret — the service-role key was already in every function's environment. `docs/threat-model.md` needs a new entry for the deletion path (the Edge Function's operand provenance, the sole-versus-shared race, the swept-then-aborted Storage residual), and T2's "service-role key ends up in the client bundle" is unchanged, since nothing here moves the key toward the client. `.claude/skills/security-check` applies on every trigger category it has: auth, RLS, destructive operations, Storage, and a new credential path.

**Verification this cannot ship without.** pgTAP for the RPC covering sole member, shared member, non-member denial, the already-half-deleted re-run, and a direct proof that the FK changes actually permit an `auth.users` delete. A cross-household case proving one account's deletion cannot touch another household's data. A test that the deletion function has no id parameter to abuse. And the two-device acceptance — B deletes their account, A's library, plans and history survive with B's recipes still present and unattributed — because that is the property this whole ADR exists to protect, and no single-connection test can demonstrate it.

**Cost.** None. No new paid service, no model call, no scheduled compute.
