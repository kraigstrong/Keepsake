# Threat Model (Draft)

Phase 0 draft, scoped to what's knowable before any feature code exists. Revisit at the exit of every phase that introduces a new trust boundary (Phase 1: native/Share Extension surface; Phase 3: household/auth boundary; Phase 8: AI import pipeline) rather than treating this as a one-time document.

## 1. Assets

What's worth protecting, roughly in order of how bad it is if compromised:

1. **Household data** — recipes, cooking notes, planning state. Not classically "sensitive" (it's recipes), but it's private household data the PRD treats as a first-class trust concern (prd.md §30), and cross-household leakage would be a serious trust failure for a shared-household product.
2. **Server-side credentials** — `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. Full database bypass and paid-API abuse respectively if leaked.
3. **User identity / session** — auth tokens, ability to impersonate a household member.
4. **Invitation tokens** — a leaked/guessable invitation token grants household membership to an attacker (see Phase 3).
5. **Client-safe credentials** — `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Not secret by design, but still worth noting: their presence in the client bundle is expected, and RLS is the only real protection layer once someone has them (which is everyone, by design).

## 2. Trust boundaries

```
[Attacker / untrusted internet]
        |
        | (recipe URLs, deep links, Share Extension payloads)
        v
[Client app — Expo/React Native]  <-- semi-trusted: runs on a device the
        |                              household member controls, but the
        |  (Supabase client SDK,        app's own code + dependencies are
        |   publishable key only)       still attack surface (supply chain)
        v
[Supabase — Postgres + Auth + Storage + Edge Functions]  <-- the real
        |                                                     enforcement
        | (service-role key, server-side only)                boundary
        v
[Anthropic API]  <-- external AI provider, receives page text (Phase 8)
```

- **Client → Supabase:** the client only ever holds the publishable key. Every access-control decision that matters is enforced by RLS/Storage policy at this boundary, never by client-side filtering (execution-plan.md §2.6, prd.md §30). This is the load-bearing boundary for household isolation.
- **Server (Edge Functions) → Supabase (service role) / Anthropic:** the only place the service-role key and Anthropic key exist. Never shipped to the client (SEC-02).
- **Untrusted internet → import fetcher (Phase 8):** the fetcher retrieves attacker-influenced content (any URL a user pastes) and feeds it toward an AI call. Covered in detail below.

## 3. Actors

- **Legitimate household member** — the intended user. Can see/edit everything in their own household(s), nothing in others.
- **Ex-household-member / removed member** — should lose access immediately on removal; no lingering token validity.
- **Opportunistic attacker with a leaked invitation link** — the invitation-token threat.
- **Malicious or compromised recipe website** — the import-pipeline threat; the site doesn't need to "attack" anything sophisticated, just serve content designed to manipulate the AI extraction step or the fetcher itself.
- **Attacker who has fully compromised a household member's device** — out of scope to fully defend against (if the device is owned, the session is owned), but session/credential handling shouldn't make this *worse* than it has to be (e.g., no plaintext service-role key ever reaching the device, even transiently).

## 4. Primary threats and mitigations

| # | Threat | Mitigation | Owning phase |
|---|---|---|---|
| T1 | Cross-household data access via a missing/wrong RLS policy | RLS on every table + Storage policy on every bucket; a test proving a non-member is denied is required evidence, not optional (security-check skill §2) | 3 |
| T2 | Service-role or Anthropic key ends up in the client bundle | Keys only ever loaded server-side (Edge Functions); CI check for "no server credential in client bundle" (Phase 0 automated validation) | 0 (CI gate), continuous |
| T3 | Secret committed to Git | gitleaks in CI + pre-commit best-effort; policy in execution-plan.md §2.7 | 0 |
| T4 | Invitation token guessed or replayed after use/expiry | Tokens are single-use, expiring, and validated server-side; hashed at rest, not stored/logged in plaintext | 3 |
| T5 | Malicious recipe page attempts prompt injection against the Claude extraction call | Implemented (ADR-0015): `reduceHtmlToText` strips scripts/styles/comments/nav chrome to text-only content before any AI call (removes the highest-bandwidth injection vector); `RecipeExtractionSchema` (`.strict()`) rejects any AI output outside its declared shape before persistence, never trusted to "confidently invent" (prd.md §30, AI-08). Not fully closable in-band: text content itself can still carry an injection attempt ("ignore previous instructions...") — the schema validation is the actual backstop, since even a successfully-injected response can only produce a schema-valid recipe extraction, nothing else (no tool calls, no arbitrary field types) | 8 |
| T6 | Import fetcher used as an SSRF vector (URL points at internal/private infrastructure) | Implemented (`server/import/secureFetch.ts`, ADR-0015): raw IP-literal hosts rejected outright; DNS resolved and every address checked against private/loopback/link-local/multicast/reserved ranges (IPv4 + IPv6, including IPv4-mapped) for the origin *and* every redirect hop; byte cap, timeout, content-type allowlist. Verified live against the deployed Edge Function, not just Jest: real requests to `169.254.169.254` (cloud metadata) and `127.0.0.1` both rejected with `ip_literal_host`. Named residual risk, not silently closed: DNS-rebinding TOCTOU between our resolution check and `fetch()`'s own internal DNS lookup — closing it needs raw socket control, deliberately deferred (see ADR-0015's Consequences) | 8 |
| T7 | Destructive operation (delete, archive) triggered by a replayed or forged client request | Reauthorized server-side, idempotent against retries (execution-plan.md §2.6, SEC-07) | 16 (primary) |
| T8 | Dependency supply-chain compromise (malicious/compromised npm package) | Dependabot + `npm audit --omit=dev --audit-level=high` in CI (runtime app/server dependencies only — build-tooling-only devDependencies are documented separately, see ci.yml); lockfile committed, not regenerated ad hoc | 0 |
| T9 | Sensitive household content (recipe text, cooking notes) leaks via error/analytics telemetry | logError/trackEvent abstraction (ADR-0006) is the only path to Sentry/PostHog; Sentry `beforeSend` redaction and PostHog's event allowlist are both enforced at that single choke point | 0 (abstraction), 2 (enforcement wiring) |
| T10 | A removed household member's session/token keeps working after removal | Session/membership check happens server-side per request, not cached client-side indefinitely | 3 |
| T11 | Password guessing / credential stuffing against the opt-in password sign-in path (ADR-0012) | Already covered by Supabase Auth's existing per-IP rate limit on sign-in requests (`config.toml`'s `[auth.rate_limit] sign_in_sign_ups`), not a new mechanism; `signInWithPassword`'s error message is generic regardless of whether the email exists or the password is wrong, so it isn't a user-enumeration oracle; `minimum_password_length` raised to 8 | 3 (rate limit), — (opt-in addition) |
| T12 | A retried or duplicated import submission (the Share Extension outbox retrying after an app kill or a network blip, or a bulk batch resubmitted after one) creates a duplicate recipe or spends Anthropic tokens twice for the same logical attempt | Implemented (ADR-0016): `create_import_job`/`create_import_batch` are idempotent on a client-generated id (`client_import_id`/`client_batch_id`) — a replay with an already-seen id returns the existing job/batch as-is instead of inserting a duplicate; the Edge Function skips the entire fetch/AI/save pipeline whenever the resolved job isn't `'processing'`, so a replay of an *already-finished* job never re-fetches or re-charges Anthropic. A real gap in that alone was found via live testing 2026-08-05, not just reasoned about: two *concurrent* callers finding the same still-`'processing'` job both proceeded to run the pipeline independently, producing two recipes for one import — the finished/not-finished check does nothing for a job neither caller has finished yet. Closed by `claim_import_job` (same migration set): an atomic claim (`claimed_at`, 60s staleness window before a claim is considered abandoned and reclaimable) makes running the pipeline for a given job a single-winner operation regardless of how many callers reach it concurrently. `recipes(household_id, source_url)` (partial unique index, non-null only) is a database-level backstop for the same failure mode independent of this specific fix — a second concurrent save for the same URL fails outright rather than silently duplicating. The Share Extension itself still carries no privileged credentials (only a URL, a timestamp, and the client-generated id it mints — the constraint Phase 1's spike established still holds unchanged) | 9 |
| T13 | Bulk import used to exhaust a household's import rate limit (T6-adjacent: cost control, not SSRF) in a single call | Implemented (ADR-0016): `create_import_batch` caps a single call at 20 URLs and checks the existing 30/rolling-hour household cap against `current_count + batch size` up front, rejecting the whole batch atomically — never a partially-queued batch a scripted client could exploit to probe the boundary one item at a time | 9 |

## 5. Explicitly out of scope for MVP

- Defending against a fully compromised end-user device (jailbroken/rooted, malware-infected). Standard mobile-app assumption.
- Protecting recipe content from the household members it's shared with — by design, all household members have equal access (prd.md, HH-03).
- Nation-state-level adversaries. This is a household recipe app, not a target for that threat class; proportionate defense is the goal, not maximal defense.

## 6. Open questions to revisit

- Once Phase 3 lands real auth, re-examine session/token lifetime and refresh behavior against T10 specifically — this draft describes the intent, not a verified implementation.
