# Credential Rotation and Incident Response

Practical runbook version of the policy in execution-plan.md §2.7. That section says *what's required*; this doc says *what to actually do, in order*, at the moment it's needed — written to be usable under stress, not just read once.

## If a secret is ever committed to Git (§2.7)

Do these in order. Don't skip ahead to "remove it from history" before rotating — the exposure already happened the moment it was pushed anywhere reachable, and history rewrite doesn't undo that.

1. **Rotate/revoke it immediately.** Don't wait to assess severity first — assume worst case and rotate, then investigate.
   - Supabase service-role key → Supabase dashboard → Project Settings → API → regenerate.
   - Anthropic API key → console.anthropic.com → Settings → API Keys → revoke the exposed key, generate a new one.
   - Update the corresponding 1Password item (`Keepsake Server` environment) with the new value immediately after rotating.
2. **Determine where it was exposed.** Local commit only (never pushed)? Pushed to a private repo? Public? Check `git log` for how far it traveled, and check any CI logs, PR diffs, or GitHub notifications that might have echoed the value.
3. **Remove it from history when appropriate.** Only after rotation (step 1) — a history rewrite on an already-rotated secret is cleanup, not urgent; on a not-yet-rotated secret it's a false sense of safety. Use `git filter-repo` or GitHub's secret-removal guidance, not a simple revert (a revert commit still leaves the secret in history).
4. **Review access logs.** Supabase: check the dashboard's API logs for the key's usage window. Anthropic: check console.anthropic.com usage/billing for anomalous activity in the exposure window.
5. **Document the incident.** A short note is enough: what leaked, when, how it was found, what was rotated, what (if anything) shows in the access logs. Keep it somewhere durable (this repo's issue tracker or a dated note in this file's history) — don't let it live only in a chat transcript.
6. **Improve automated prevention.** If gitleaks (`.gitleaks.toml`, CI job) didn't catch it, that's the actual bug to fix — figure out why and close the gap (new rule, new allowlist correction, whatever's needed) before considering the incident closed.

## Routine (non-incident) credential rotation

Do this periodically even without a known leak — treat it as hygiene, not just incident response.

1. Generate the new credential in the vendor console (Supabase / Anthropic / any future vendor).
2. Update the value in the relevant 1Password Environment (`Keepsake Client` or `Keepsake Server`).
3. Redeploy/restart whatever consumes it (local dev processes just need their mount refreshed; deployed Edge Functions need `supabase secrets set` re-run — see the CI/CD secrets pattern discussed when Phase 0 was set up).
4. Revoke the old credential in the vendor console only after confirming the new one works — don't revoke-then-verify.

## Who does this

This is currently a single-developer project — there's no on-call rotation or second approver. The steps above are written so a single person under time pressure can follow them without having to reconstruct the reasoning first. If the team ever grows, revisit this doc to add ownership/escalation, not just steps.
