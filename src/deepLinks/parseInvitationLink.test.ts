import { parseInvitationLink } from './parseInvitationLink';

const VALID_TOKEN = 'abcDEF123456_-xyzQRS789';

describe('parseInvitationLink — accepts well-formed links', () => {
  it('parses a valid invitation link', () => {
    const result = parseInvitationLink(`keepsake://invite/${VALID_TOKEN}`);
    expect(result).toEqual({ ok: true, token: VALID_TOKEN });
  });

  it('accepts a token at the minimum length boundary (16 chars)', () => {
    const token = 'a'.repeat(16);
    expect(parseInvitationLink(`keepsake://invite/${token}`)).toEqual({ ok: true, token });
  });

  it('accepts a token at the maximum length boundary (128 chars)', () => {
    const token = 'a'.repeat(128);
    expect(parseInvitationLink(`keepsake://invite/${token}`)).toEqual({ ok: true, token });
  });
});

describe('parseInvitationLink — rejects manipulated or malformed links', () => {
  const cases: [string, string][] = [
    ['not a URL at all', 'garbage input'],
    ['https://invite/' + VALID_TOKEN, 'wrong scheme (https instead of custom scheme)'],
    ['javascript:alert(1)', 'script-injection scheme'],
    ['keepsake://invite/', 'missing token, trailing slash'],
    ['keepsake://invite', 'missing token, no trailing slash'],
    ['keepsake://accept/' + VALID_TOKEN, 'wrong path segment'],
    ['keepsake://invite/' + VALID_TOKEN + '/extra', 'extra path segment'],
    ['keepsake://invite/short', 'token below minimum length'],
    ['keepsake://invite/' + 'a'.repeat(129), 'token above maximum length'],
    ['keepsake://invite/abc def', 'token with a space'],
    ['keepsake://invite/abc%20def', 'token with an encoded space'],
    ['keepsake://invite/../../etc/passwd', 'path traversal attempt'],
    ['keepsake://invite/%2e%2e%2fetc', 'encoded path traversal attempt'],
    [
      'keepsake://invite/' + VALID_TOKEN + '?redirect=evil.example.com',
      'unexpected query parameter',
    ],
    [
      'keepsake://invite/' + VALID_TOKEN + '?token=' + VALID_TOKEN,
      'duplicate token via query param',
    ],
  ];

  it.each(cases)('rejects: %s (%s)', (url) => {
    const result = parseInvitationLink(url);
    expect(result.ok).toBe(false);
  });
});
