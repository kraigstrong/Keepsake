/**
 * Account deletion (ADR-0028). This is the **one** function in this repo
 * permitted to construct a service-role client, and the exception is
 * written down in AGENTS.md rather than implied here.
 *
 * The exception is narrow by construction, not by intention:
 *
 *   - The only privileged call is `auth.admin.deleteUser(id)`.
 *   - `id` comes from `getUser()` on a caller-JWT client, which validates
 *     against the auth server. It is never read from the request.
 *   - The request carries exactly one field, `mode`, and it is not an
 *     account selector: it is the sole/shared answer the user was shown
 *     on the confirmation screen, echoed back so the RPC can abort if the
 *     household changed underneath it. Three legal values, rejected here
 *     and re-validated in SQL. No id, email, or other selector is read
 *     from the request under any name.
 *   - The data half runs on the caller's own JWT, so RLS and `auth.uid()`
 *     still govern it exactly as they do everywhere else.
 *
 * What makes an elevated credential dangerous is not its power but its
 * steerability: the security of code holding one reduces to where its
 * operands come from. There is one operand here and the caller cannot
 * supply it. Anyone wanting to delete someone else's account would have
 * to become them first, at which point they did not need this function.
 *
 * Decoding the JWT payload locally to read `sub` would defeat all of
 * that — the token is entirely caller-controlled, so an unverified read
 * turns this into `deleteUser(anyone)`. The id must come from `getUser()`,
 * and `verify_jwt` stays on (declared in config.toml, asserted by
 * check:drift) so the platform rejects an unauthenticated request before
 * it reaches this code at all.
 *
 * Ordering is load-bearing and comes from ADR-0028 decision 4: the data
 * transaction commits first, the auth row goes last. There is therefore
 * no state in which authentication fails and work remains — which is what
 * makes "the caller can no longer authenticate" a safe terminal signal
 * for the client, but only after a deletion has actually been attempted.
 */
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Server is misconfigured' }, 500);
  }

  // Caller-scoped client. Everything except the final auth-row delete
  // runs through this, so RLS applies exactly as it does elsewhere.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });

  // The single operand, and the only place it may come from.
  const { data: userData, error: userError } = await caller.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  // The fence has to come from the client: its whole purpose is that the
  // answer the *user* confirmed against is what gets checked. A value
  // this function derived for itself would be checked against itself and
  // prove nothing. Read narrowly and rejected early -- the RPC validates
  // it again and re-derives the truth under a row lock regardless.
  let mode: unknown;
  try {
    mode = (await req.json())?.mode;
  } catch {
    return jsonResponse({ error: 'Expected a JSON body' }, 400);
  }
  if (mode !== 'sole' && mode !== 'shared' && mode !== 'no_household') {
    return jsonResponse({ error: 'Invalid mode' }, 400);
  }

  // The data half, on the caller's JWT. Idempotent by postcondition, so a
  // retry after a partial failure completes rather than erroring.
  const { error: rpcError } = await caller.rpc('delete_own_account', {
    expected_mode: mode,
  });
  if (rpcError) {
    return jsonResponse({ error: rpcError.message, stage: 'data' }, 400);
  }

  // Everything above this line could have run without elevated rights.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    return jsonResponse({ error: 'Server is misconfigured', stage: 'auth' }, 500);
  }

  const elevated = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: deleteError } = await elevated.auth.admin.deleteUser(userId);
  if (deleteError) {
    // The data is gone and the marker row records that this step still
    // owes work. Reported as retryable rather than fatal: the client
    // retries in-process before it reports success, because the person
    // who just deleted their account is exactly the person who will not
    // come back to finish it later.
    return jsonResponse({ error: deleteError.message, stage: 'auth' }, 502);
  }

  return jsonResponse({ deleted: true }, 200);
});
