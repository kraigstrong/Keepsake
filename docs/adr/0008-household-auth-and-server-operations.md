# ADR-0008: Email OTP authentication and Postgres RPC for household operations

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 3

## Context

Phase 3's build scope (execution-plan.md) names "real auth wiring" and "household creation/invitation acceptance operations" but doesn't specify a mechanism for either — neither does the PRD. Two decisions are needed before schema or client code can be written:

1. **How users authenticate.** PRD §3 describes the primary users as non-technical households managing shared recipes — not a developer or power-user audience. PRD's overall tone (prd.md's repeated "calm," minimal-friction framing) argues against anything that adds setup friction.
2. **Where multi-table household/invitation operations execute.** Household creation (household + membership rows) and invitation acceptance (membership insert + invitation consumption) are each atomic multi-table writes that must not be left half-applied, and invitation acceptance in particular must validate a hashed, single-use, expiring token server-side per `docs/threat-model.md` T4 — this can't be safely assembled from separate client-side inserts even under RLS.

## Decision

**Authentication: Supabase Auth email OTP (magic link / 6-digit code), not passwords.** No new password for a household member to create or recover, matching the PRD's non-technical, low-friction audience. Confirmed locally testable without real SMTP credentials: `supabase/config.toml`'s `[auth.email]` has `enable_signup = true`, `enable_confirmations = false` (no separate confirmation step blocking first sign-in), `otp_length = 6`, `otp_expiry = 3600`, and no `[auth.email.smtp]` block configured — local dev mail is caught by the Supabase CLI's bundled Inbucket instance, not sent externally. Session handling continues to satisfy the `Session`/`SessionProvider` boundary ADR-0007 already built (Phase 3 replaces the stub's contents, not its shape).

**Server operations: Postgres RPC functions (`SECURITY DEFINER`), not Edge Functions.** Household creation and invitation acceptance are implemented as `SECURITY DEFINER` SQL functions callable via `supabase.rpc(...)`, executing as a single transaction so partial writes aren't observable. Edge Functions are reserved for Phase 8+'s external Anthropic API calls, where a request needs to leave Postgres entirely (a real distinguishing reason to use them) — household/invitation operations never leave the database, so the extra deployment surface of an Edge Function buys nothing here.

## Alternatives considered

- **Password-based auth:** rejected — adds a secret for non-technical users to choose, remember, and recover, with no PRD-stated need for it over OTP.
- **Third-party OAuth (Google/Apple sign-in):** would work but adds an external identity provider dependency and per-provider setup (Apple requires a paid developer account entitlement, Google requires console setup) before any user can sign in at all; email OTP needs neither and matches the "just an email address" simplicity of household invites already planned for Phase 3.
- **Edge Functions for household/invitation operations:** rejected for this phase — no PRD requirement calls for logic outside Postgres here, and Edge Functions would mean maintaining a second runtime/deploy path for operations that are pure data-integrity logic, not external I/O.
- **Assembling household creation / invitation acceptance from sequential client-side inserts under RLS:** rejected outright — invitation acceptance in particular needs server-side token validation (hash comparison, expiry, single-use) that must not be trusted to the client, per threat-model.md T4; and multi-table writes need atomicity a sequence of client calls can't guarantee.

## Consequences

- No new external credential or account is needed for local development — Inbucket handles OTP email locally. Staging/production SMTP configuration (a real provider, e.g. SendGrid per the commented-out `config.toml` example) is a deferred, credentialed decision to raise with the developer before Phase 3 exits or whenever staging auth is first exercised — not needed to build or test this phase locally.
- `SECURITY DEFINER` functions run with elevated privilege deliberately — each one must explicitly re-check caller identity/membership internally (via `auth.uid()`) rather than relying on the caller's own RLS context, since `SECURITY DEFINER` bypasses the caller's RLS by design. This needs to be called out in each function's own code comment and covered by a pgTAP test asserting a non-member/non-caller can't invoke it to affect another household.
- Later phases adding more multi-table atomic operations (e.g., Phase 9's queued import writes) should default to the same RPC pattern unless a concrete reason (external I/O, long-running work) argues for an Edge Function instead.
