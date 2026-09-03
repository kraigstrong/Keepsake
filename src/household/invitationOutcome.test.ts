import { classifyInvitationFailure, invitationFailureMessage } from './invitationOutcome';

// The four conditions accept_invitation raises, verbatim from
// 20260806090000_invitation_acceptance_fencing.sql. If that function
// grows a fifth, this list is what should catch the omission.
const TERMINAL_ERRORS = [
  { code: 'P0001', message: 'invalid invitation token' },
  { code: 'P0001', message: 'invitation has already been used' },
  { code: 'P0001', message: 'invitation has expired' },
  { code: 'P0001', message: 'user already belongs to a household' },
];

describe('classifyInvitationFailure', () => {
  it.each(TERMINAL_ERRORS)('treats the RPC rejection "$message" as terminal', (error) => {
    expect(classifyInvitationFailure(error)).toBe('terminal');
  });

  // The 401 case is the one that actually happened, 2026-09-01: a request
  // beat supabase-js's new access token onto the wire and a real invitee
  // was told her invitation had failed.
  it.each([
    ['a stale-token 401', { code: '401', message: 'JWT expired' }],
    ['a gateway failure', { code: '503', message: 'service unavailable' }],
    ['a dropped socket', new TypeError('Network request failed')],
    ['a plain string', 'something went wrong'],
    ['null', null],
    ['undefined', undefined],
    ['an error with no code', { message: 'unhelpful' }],
  ])('treats %s as transient, so the token survives', (_label, error) => {
    expect(classifyInvitationFailure(error)).toBe('transient');
  });

  it('defaults an unrecognised Postgres error code to transient', () => {
    // 40001 is a serialization failure — genuinely worth retrying, and
    // exactly the kind of code a future migration could start raising.
    expect(classifyInvitationFailure({ code: '40001', message: 'could not serialize' })).toBe(
      'transient',
    );
  });
});

describe('invitationFailureMessage', () => {
  it('tells a transient failure that the invitation is still saved', () => {
    expect(invitationFailureMessage({ code: '503' })).toContain('still saved');
  });

  it('explains the one-household rule rather than repeating the server wording', () => {
    const message = invitationFailureMessage({
      code: 'P0001',
      message: 'user already belongs to a household',
    });
    expect(message).toContain('one household per account');
    expect(message).not.toContain('user already belongs');
  });

  it.each([
    ['invitation has expired', 'expired'],
    ['invitation has already been used', 'already been used'],
    ['invalid invitation token', "isn't valid"],
  ])('turns "%s" into an actionable message', (serverMessage, expected) => {
    expect(invitationFailureMessage({ code: 'P0001', message: serverMessage })).toContain(expected);
  });

  it('falls back to the invalid-link wording for an unrecognised terminal message', () => {
    expect(invitationFailureMessage({ code: 'P0001', message: 'something new' })).toContain(
      "isn't valid",
    );
  });
});
