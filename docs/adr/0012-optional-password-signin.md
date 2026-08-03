# ADR-0012: Optional password sign-in alongside email OTP

- **Status:** Accepted
- **Date:** 2026-08-04
- **Phase:** — (cross-cutting addition, not a numbered execution-plan phase)

## Context

ADR-0008 chose email OTP as the sole sign-in method, reasoning that a non-technical household
audience shouldn't need to choose, remember, or recover a password. That reasoning holds for the
household as a default — but it's a poor fit for a household member who already runs a password
manager and would rather type (or autofill) a password than wait on an email round-trip every
sign-in. The ask here is explicitly opt-in, not a reversal: add a password as an alternative for
whoever wants one, without changing anything for anyone who doesn't.

## Decision

**Email OTP remains the default and the only sign-in method available until a user explicitly
sets a password.** Nothing changes for an existing or future household member who never visits
the new Settings flow below.

**A signed-in user can add a password to their own account from Settings**, via
`supabase.auth.updateUser({ password })`. This sets a password on the *same* Supabase Auth user
record — it doesn't create a separate identity and doesn't disable OTP for that account. Supabase
Auth natively supports a single user having both a password and OTP-based sign-in at once, so no
new schema or server operation is needed for this.

**Once a password is set, the sign-in screen offers "Sign in with password instead" as an
alternate path**, calling `supabase.auth.signInWithPassword`. A user who hasn't set a password
yet and taps this anyway just gets Supabase's normal auth error, surfaced with a nudge back to
the code flow or to set a password from Settings first — no separate "does this email have a
password" check is needed before offering the option.

**`minimum_password_length` raised from Supabase's project default of 6 to 8** in
`supabase/config.toml`, with `password_requirements` left empty (no forced character-class mix).
Current NIST/1Password guidance treats length as the primary strength lever and composition
rules as counterproductive — they push people toward predictable substitutions rather than
stronger passwords. This is opt-in for people likely already using a password manager to
generate a high-entropy value anyway, so there's no real benefit to a composition rule beyond
irritation.

**Password fields use `textContentType="password"` / `"newPassword"`** (matching the existing
`textContentType="oneTimeCode"` on the OTP field) so iOS's own credential UI — including 1Password
via autofill, not just iCloud Keychain — can suggest, save, or generate a value. A concrete,
low-cost win from treating this as a real password field.

**No change to RLS, household membership, or any authorization boundary.** The method used to
establish a session is orthogonal to what that session can subsequently do — this is a client
authentication convenience, not a security-boundary change.

## Alternatives considered

- **Passkeys instead of, or alongside, passwords:** rejected for now — Expo/React Native has no
  built-in passkey API; it would need a third-party native module plus a config plugin, and
  Supabase's own passkey/WebAuthn support is newer and less proven than its password support.
  This is realistically its own risk-spike-sized effort (matching Phase 1's native-capability
  spikes), not a fit for a quick opt-in addition. Revisit if there's real appetite for it later.
- **Making password the default or primary method:** rejected — would reverse ADR-0008's
  reasoning for every household member who isn't the one asking for this. OTP stays the
  low-friction, nothing-to-remember default.
- **A separate linked identity for password sign-in:** rejected — unnecessary complexity; Supabase
  Auth already supports both methods on one user record.
- **Requiring re-authentication before setting a password (`secure_password_change`):** left at
  its `false` default — the user is already in an active, OTP-verified session when they reach
  Settings; requiring them to re-prove that a second time to set a password adds friction ADR-0008
  already argued against, for no real benefit given the session is already authenticated.

## Consequences

- Settings gains a "Set a password" flow (new password + confirmation), and `SessionProvider`
  gains `setPassword`/`signInWithPassword` alongside the existing `sendOtp`/`verifyOtp`.
- The sign-in screen's email step gains a second path ("Sign in with password instead") next to
  the existing "Send code" button.
- `supabase/config.toml`'s `minimum_password_length` change is config-only, no migration needed.
- If Phase 6's offline/local-auth work or any later phase needs to reason about "how did this
  session get established," both paths still resolve to the same `Session` shape
  `SessionProvider` already exposes — nothing downstream needs to branch on sign-in method.
