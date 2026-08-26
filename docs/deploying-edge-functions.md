# Deploying a Supabase Edge Function

Deploying a function (`supabase/functions/<name>/`) is a separate step from pushing migrations (`supabase db push`) — updating one never updates the other. `docs/current.md`'s Staging section tracks both independently; check it before assuming staging matches `main`.

## Credentials

Deploying needs the **Keepsake Dev Tools** 1Password Environment (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` — see the project's secrets-setup notes), mounted locally as `devtools.env`. That file is a **named pipe (FIFO)**, not a regular file — it's served live by a 1Password background process, not stored on disk.

**Do not `cat`, `echo`, or otherwise print this file's contents to a visible stream.** A single read into shell variables is safe; piping it to stdout (directly, or via `cat file | xargs`, `set -a; source` with `-x` tracing on, etc.) puts a live access token in terminal scrollback, tool output, and potentially session logs. There is no way to un-print a secret once it's been echoed — treat this as a hard rule, not a style preference.

Because shell state doesn't persist between separate command invocations in this environment, the credential load and the deploy command that uses it must happen **in the same shell invocation**.

## Known gotcha: `SUPABASE_PROJECT_REF` may be stored as a full URL

The 1Password item has previously held the full project URL (`https://xxxxx.supabase.co`) instead of the bare ref (`xxxxx`). `supabase link`/`--project-ref` reject the URL form. Always strip it defensively rather than assuming it's already bare:

```bash
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF#https://}"
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF%.supabase.co}"
```

## Deploy

The `supabase` CLI is a project devDependency, not installed globally — invoke it via `npx`.

```bash
set -a
source devtools.env
set +a
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF#https://}"
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF%.supabase.co}"

npx supabase functions deploy <function-name> --project-ref "$SUPABASE_PROJECT_REF"
```

This bundles and deploys in one step — no separate build. Deno-only code (`supabase/functions/**`) is type-checked at deploy time, not by `npm run typecheck` (that command's `tsconfig.json` excludes the directory — see `AGENTS.md`'s Canonical commands note).

## Verify

```bash
set -a
source devtools.env
set +a
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF#https://}"
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF%.supabase.co}"

npx supabase functions list --project-ref "$SUPABASE_PROJECT_REF"
```

Confirm the deployed function's `version` incremented and `status` is `"ACTIVE"`. The response includes the bare project ref in plaintext (also visible in the client's own `EXPO_PUBLIC_SUPABASE_URL`, so not sensitive on its own) — the access token itself is never echoed by either command above.
