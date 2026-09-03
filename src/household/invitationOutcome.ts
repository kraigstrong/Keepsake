/**
 * Whether a failed `accept_invitation` call can be retried with the same
 * token, or whether that token is finished.
 *
 * The distinction is the whole point: clearing a pending token is
 * irreversible in practice — there is no way back to the link once the
 * app has forgotten it, and the screen the invitee lands on next offers
 * "Create a household", which under ADR-0004 cannot be undone. So a
 * dropped connection must not look like a dead invitation.
 *
 * `accept_invitation` (20260806090000_invitation_acceptance_fencing.sql)
 * raises `P0001` for every condition it deliberately rejects, and only
 * those: unknown token, already used by someone else, expired, and
 * caller already in a household. Anything else reaching here — a 401
 * from a not-yet-attached access token, a 5xx, a dropped socket, a
 * timeout — is the transport failing, not the invitation.
 *
 * Unknown shapes are therefore transient by default. Retrying a genuinely
 * dead token costs one more request and shows the same message; clearing
 * a live one costs the invitee their household.
 */
export type InvitationFailureKind = 'terminal' | 'transient';

const TERMINAL_POSTGRES_CODE = 'P0001';

export function classifyInvitationFailure(error: unknown): InvitationFailureKind {
  if (typeof error !== 'object' || error === null) return 'transient';
  const code = (error as { code?: unknown }).code;
  return code === TERMINAL_POSTGRES_CODE ? 'terminal' : 'transient';
}

/**
 * What the invitee is told. The server's own message is deliberately not
 * shown: its wording is aimed at a developer reading a stack trace, and
 * "user already belongs to a household" in particular reads as an
 * accusation rather than an explanation.
 */
export function invitationFailureMessage(error: unknown): string {
  if (classifyInvitationFailure(error) === 'transient') {
    return "We couldn't reach Keepsake just now. Your invitation is still saved.";
  }

  const raw =
    typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : null;
  const message = typeof raw === 'string' ? raw : '';

  if (message.includes('already belongs to a household')) {
    return "You're already in a household, so this invitation can't be applied. Keepsake supports one household per account.";
  }
  if (message.includes('expired')) {
    return 'This invitation has expired. Ask whoever invited you to send a new link.';
  }
  if (message.includes('already been used')) {
    return 'This invitation has already been used. Ask whoever invited you to send a new link.';
  }
  return "This invitation link isn't valid. Ask whoever invited you to send a new one.";
}
