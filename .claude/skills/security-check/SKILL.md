---
name: "security-check"
description: "Use before committing changes that touch authentication, household/RLS boundaries, secrets or credentials, external input (URLs/uploads/deep links/AI output), Storage access, or any destructive operation. Also use as a standalone audit pass when asked to review security. Not needed for purely internal refactors with no new data or trust boundary."
---

Running the continuous-security checklist from `docs/execution-plan.md` §2.6 against the current change.

## 1. Identify what changed

From `git diff` (staged or against base branch), classify the change against these categories from execution-plan.md §2.6:

- Authentication and authorization
- Household isolation
- Credential and secret handling
- Dependency and supply-chain risk
- Input validation
- Privacy and data minimization
- Logging and telemetry safety
- Storage access
- Destructive operations
- Native permissions
- AI boundaries
- Abuse controls
- Recovery and incident response

Most changes will only touch one or two categories — that's fine, just be explicit about which.

## 2. Apply the relevant checks

For each touched category:

- **Household isolation:** Is this enforced server-side (RLS / Storage policy), not just filtered client-side? Is there a test proving a non-member is denied?
- **Credentials:** Does anything touch a secret, token, or `.env` value? If yes, is it going through 1Password CLI/Environments, never hardcoded or logged? Run a mental (or actual) secret scan over the diff.
- **External input:** Is the new input (URL, upload, deep link, AI output) validated before use/persistence? For fetchers specifically: SSRF protections, redirect revalidation, size/timeout limits, content-type checks.
- **AI boundaries:** Does AI output get validated against a schema before persistence? Does uncertain output get flagged rather than silently accepted?
- **Destructive operations:** Is it reauthorized server-side (not just gated in the client)? Is it idempotent against retries?
- **Logging/telemetry:** Does anything log recipe content, cooking notes, credentials, or other sensitive household data? Check both application logs and any analytics event payloads.

## 3. Cross-check against the Release-Blocking Defect Rules

Read the "Critical" list near the end of `docs/execution-plan.md`. If the change could plausibly cause any Critical item (cross-household access, secret in Git, server credential in client, unauthenticated destructive operation, unrestricted Storage, SSRF, etc.), treat it as blocking — do not commit until resolved, regardless of how small the change looks otherwise.

## 4. Report

State plainly: which categories applied, what was checked, what evidence exists (test names, not just "looks fine"), and any open finding. If there's an open finding that isn't resolved in this change, it needs either a fix now or an explicit, visible deferral (in `docs/current.md` or the PR description) — not silence.
