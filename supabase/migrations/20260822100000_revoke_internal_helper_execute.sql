-- resolve_selection_round_deadline is an internal helper: every
-- round-scoped RPC calls it, and a SECURITY DEFINER function's nested
-- calls run as the function owner, so no client grant is needed. The
-- lifecycle migration revoked it `from public`, which is sufficient
-- locally but not on a real Supabase project.
--
-- Why: Supabase projects carry default privileges that grant EXECUTE on
-- newly created functions to anon and authenticated. Those are explicit
-- per-role grants, so revoking `from public` leaves them intact. Verified
-- against staging after 20260821100000 was applied: an anonymous
-- POST /rest/v1/rpc/resolve_selection_round_deadline returned 204 — it
-- executed. Locally the same function's ACL was postgres=X/postgres, so
-- the gap is invisible without testing a real project.
--
-- Impact of the exposure was low: the function only performs the
-- active -> ready_for_review transition a round is already due for
-- (closes_at < now()), returns void, and reads nothing back. But it is a
-- SECURITY DEFINER function that was never meant to be client-callable,
-- and the same idiom on a future helper could be far worse.
--
-- Revoke from all three explicitly. Any future internal helper must do
-- the same — `revoke ... from public` alone is not enough here.
revoke all on function public.resolve_selection_round_deadline(uuid) from public;
revoke all on function public.resolve_selection_round_deadline(uuid) from anon;
revoke all on function public.resolve_selection_round_deadline(uuid) from authenticated;
