# Risk Spike: Invitation Deep Link Parsing

**Phase 1.** Proves deep links reach the app and parse/reject correctly before Phase 3 builds real invitation acceptance (token validation, expiry, single-use) on top. This spike only judges link *shape* — a well-formed token here is not a valid invitation; that's server-side only, matching prd.md §30 and the "Invitation-token exposure" release-blocking defect rule.

## Question

Does the custom URL scheme actually reach the app reliably, and does parsing correctly reject manipulated links — not just well-formed-but-invalid ones, but genuinely adversarial ones (path traversal, script schemes, injected query params)?

## Scope decision

Scoped to the custom URL scheme (`keepsake://`) only. Universal links (`https://keepsake.app/invite/...`) need an Apple App Site Association file hosted on a real production domain plus the Associated Domains entitlement — no domain exists yet, so that's a Phase 3 follow-up, not part of this spike.

## Findings

**Parsing logic (`src/deepLinks/parseInvitationLink.ts`)** — 18 unit tests, all passing: singular valid-link cases plus 15 manipulation attempts (wrong scheme, `javascript:` injection, missing/extra path segments, out-of-bounds token length, embedded space, raw and URL-encoded path traversal, injected query parameters). All correctly rejected with a specific reason string, not a generic failure.

**End-to-end, on-device (not just unit-tested in isolation):** fired real URLs at the running Simulator via `xcrun simctl openurl` against the actual compiled dev client.
- Valid link (`keepsake://invite/<23-char token>`) → iOS's own "Open in Keepsake?" system confirmation appeared (confirms the URL scheme is genuinely registered at the OS level, not just in `app.json`), then the app correctly reported `accepted (token length 23)`.
- Path traversal attempt (`keepsake://invite/../../etc/passwd`) → app correctly reported `rejected: unexpected path shape` and the rejection routed through `logError()` (visible as the dev-client's in-app error banner) — confirming the security-logging path fires on a real rejection, not just in a test assertion.

**A tooling gotcha worth remembering, not a product finding:** installing `expo-linking` *after* the dev client was already built didn't work via Metro's hot reload — the app crashed at runtime with `Cannot find native module 'ExpoLinking'`. Native modules have to be compiled into the binary; only JS changes hot-reload. Fix was `pod install` + a full `expo run:ios` rebuild. Applies to every future native-module addition in this project, not just this one.

## Automated evidence

`src/deepLinks/parseInvitationLink.test.ts` — 18 tests (3 accept, 15 reject), all pure logic, no native dependency, runs in CI today.

## Security note (execution-plan.md §2.6 — external input, invitation-token exposure)

- Every rejection carries a specific reason (for logging/debugging) but the function never trusts a well-formed token as valid — token existence, expiry, and single-use enforcement stay server-side (Phase 3).
- Token charset/length bounds (16–128 chars, URL-safe base64) reject both malformed and suspiciously-shaped input before it ever reaches a server call.
- Unexpected query parameters are rejected outright rather than ignored — a legitimate invitation link has none, so their presence is itself a manipulation signal.

## Not yet done

- Universal links (see Scope decision above) — Phase 3, once a production domain exists.
- Physical-device confirmation — this spike is Simulator-verified only so far; per ADR-0003, Phase 1's exit gate wants physical-device proof, planned before this phase closes out.

## Conclusion

Chosen implementation path exists and is verified two ways — pure-logic unit tests and real on-device OS-level link delivery — not assumed from the unit tests alone.
