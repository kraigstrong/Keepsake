-- resolve_selection_round_deadline is internal: every round-scoped RPC
-- calls it, and a SECURITY DEFINER function's nested calls run as the
-- owner, so no client grant is needed.
--
-- Revoking `from public` is not enough on a real Supabase project:
-- default privileges grant EXECUTE to anon and authenticated as explicit
-- per-role grants, which a PUBLIC revoke leaves intact. The local
-- database has no such defaults, so this is invisible locally. Any
-- future internal helper must revoke all three.
revoke all on function public.resolve_selection_round_deadline(uuid) from public;
revoke all on function public.resolve_selection_round_deadline(uuid) from anon;
revoke all on function public.resolve_selection_round_deadline(uuid) from authenticated;
