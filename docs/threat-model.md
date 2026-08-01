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
| T5 | Malicious recipe page attempts prompt injection against the Claude extraction call | Page is reduced to text-only content before any AI call (removes the highest-bandwidth injection vector — embedded scripts/hidden text/HTML comments); AI output is schema-validated before persistence, never trusted to "confidently invent" (prd.md §30, AI-08); see docs/prd.md §8-9 for the text-reduction requirement added this session | 8 |
| T6 | Import fetcher used as an SSRF vector (URL points at internal/private infrastructure) | DNS + redirect revalidation, private-IP-range rejection, size/timeout limits, content-type checks — explicit Phase 8 security scope | 8 |
| T7 | Destructive operation (delete, archive) triggered by a replayed or forged client request | Reauthorized server-side, idempotent against retries (execution-plan.md §2.6, SEC-07) | 16 (primary) |
| T8 | Dependency supply-chain compromise (malicious/compromised npm package) | Dependabot + `npm audit --audit-level=high` in CI; lockfile committed, not regenerated ad hoc | 0 |
| T9 | Sensitive household content (recipe text, cooking notes) leaks via error/analytics telemetry | logError/trackEvent abstraction (ADR-0006) is the only path to Sentry/PostHog; Sentry `beforeSend` redaction and PostHog's event allowlist are both enforced at that single choke point | 0 (abstraction), 2 (enforcement wiring) |
| T10 | A removed household member's session/token keeps working after removal | Session/membership check happens server-side per request, not cached client-side indefinitely | 3 |

## 5. Explicitly out of scope for MVP

- Defending against a fully compromised end-user device (jailbroken/rooted, malware-infected). Standard mobile-app assumption.
- Protecting recipe content from the household members it's shared with — by design, all household members have equal access (prd.md, HH-03).
- Nation-state-level adversaries. This is a household recipe app, not a target for that threat class; proportionate defense is the goal, not maximal defense.

## 6. Open questions to revisit

- Once Phase 3 lands real auth, re-examine session/token lifetime and refresh behavior against T10 specifically — this draft describes the intent, not a verified implementation.
- Once Phase 8 lands the real import pipeline, re-examine T5/T6 against the actual fetcher implementation, not just the intended design.
