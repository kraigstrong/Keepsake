/**
 * Phase 1 risk-spike: proves deep-link parsing is robust against
 * manipulation before Phase 3 builds real invitation acceptance on top.
 * This function only judges *shape* — a well-formed token here is not a
 * valid invitation. Token existence, expiry, and single-use enforcement
 * are server-side only (Phase 3), matching prd.md §30 (treat deep links
 * as untrusted input) and the "Invitation-token exposure" release-
 * blocking defect rule (execution-plan.md).
 *
 * Deliberately scoped to the custom URL scheme (`keepsake://`) only.
 * Universal links (`https://keepsake.app/invite/...`) need an Apple App
 * Site Association file hosted on a real production domain plus the
 * Associated Domains entitlement — no domain exists yet, so that's a
 * Phase 3 follow-up, not part of this spike.
 */

const SCHEME = 'keepsake:';
const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 128;
// URL-safe base64 charset — matches what a server-generated random token
// (e.g. crypto.randomBytes(32).toString('base64url')) actually looks like.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ParsedInvitationLink = { ok: true; token: string } | { ok: false; reason: string };

export function parseInvitationLink(rawUrl: string): ParsedInvitationLink {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'not a well-formed URL' };
  }

  if (url.protocol !== SCHEME) {
    return { ok: false, reason: `unexpected scheme "${url.protocol}"` };
  }

  // expo-linking / WebKit split `keepsake://invite/<token>` inconsistently
  // between `hostname` and `pathname` depending on platform and whether
  // there's a real host segment — normalize by parsing host + path
  // together as one segment list rather than trusting either alone.
  const segments = [url.hostname, ...url.pathname.split('/')]
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length !== 2 || segments[0] !== 'invite') {
    return { ok: false, reason: `unexpected path shape: ${JSON.stringify(segments)}` };
  }

  const token = segments[1];
  if (token === undefined) {
    return { ok: false, reason: 'missing token segment' };
  }

  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: `token length ${token.length} out of bounds` };
  }

  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, reason: 'token contains invalid characters' };
  }

  // Reject anything carrying extra query params — a legitimate invitation
  // link has none, so their presence is itself a sign of tampering rather
  // than something to silently ignore.
  if (url.search.length > 0) {
    return { ok: false, reason: 'unexpected query parameters' };
  }

  return { ok: true, token };
}
