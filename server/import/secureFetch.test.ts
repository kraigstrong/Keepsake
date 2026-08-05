import { isIpLiteralHostname, isPublicIp, secureFetch, SecureFetchError } from './secureFetch';

describe('isPublicIp', () => {
  it('allows a real public IPv4 address', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
  });

  it.each([
    ['0.0.0.0', 'this network'],
    ['10.0.0.1', 'RFC 1918'],
    ['10.255.255.255', 'RFC 1918 upper bound'],
    ['100.64.0.1', 'CGNAT'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback upper bound'],
    ['169.254.1.1', 'link-local'],
    ['172.16.0.1', 'RFC 1918'],
    ['172.31.255.255', 'RFC 1918 upper bound'],
    ['192.168.1.1', 'RFC 1918'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it('does not block addresses just outside a blocked RFC 1918 range', () => {
    expect(isPublicIp('172.15.255.255')).toBe(true);
    expect(isPublicIp('172.32.0.0')).toBe(true);
  });

  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique local'],
    ['fd00::1', 'unique local upper half'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
  ])('blocks IPv6 %s (%s)', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it('allows real public IPv6 addresses, including IPv4-mapped public ones', () => {
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
    expect(isPublicIp('2001:4860:4860::8888')).toBe(true);
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true);
  });
});

describe('isIpLiteralHostname', () => {
  it('recognizes IPv4 dotted-decimal hosts', () => {
    expect(isIpLiteralHostname('127.0.0.1')).toBe(true);
  });

  it('recognizes bracketed IPv6 hosts', () => {
    expect(isIpLiteralHostname('[::1]')).toBe(true);
  });

  it('does not treat a domain name as an IP literal', () => {
    expect(isIpLiteralHostname('example.com')).toBe(false);
    expect(isIpLiteralHostname('a.b.c.d.example.com')).toBe(false);
  });
});

function htmlResponse(body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html', ...extraHeaders },
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

const PUBLIC_DNS = async () => ['8.8.8.8'];
const PRIVATE_DNS = async () => ['127.0.0.1'];

describe('secureFetch', () => {
  it('fetches successfully when DNS resolves to a public address', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(htmlResponse('<html>hi</html>'));

    const result = await secureFetch('https://example.com/recipe', {
      resolveDns: PUBLIC_DNS,
      fetchImpl,
      allowedContentTypePrefixes: ['text/html'],
    });

    expect(result.finalUrl).toBe('https://example.com/recipe');
    expect(result.contentType).toBe('text/html');
    expect(new TextDecoder().decode(result.bytes)).toBe('<html>hi</html>');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-http(s) scheme before ever calling fetch', async () => {
    const fetchImpl = jest.fn();

    await expect(
      secureFetch('ftp://example.com/recipe', {
        resolveDns: PUBLIC_DNS,
        fetchImpl,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_scheme' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a raw IP-literal host before ever calling fetch', async () => {
    const fetchImpl = jest.fn();

    await expect(
      secureFetch('http://169.254.169.254/latest/meta-data', {
        resolveDns: PUBLIC_DNS,
        fetchImpl,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'ip_literal_host' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    const fetchImpl = jest.fn();

    await expect(
      secureFetch('https://internal.example.com/recipe', {
        resolveDns: PRIVATE_DNS,
        fetchImpl,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'private_address' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('follows a redirect to another public host and re-validates DNS for the new host', async () => {
    const resolveDns = jest
      .fn()
      .mockResolvedValueOnce(['8.8.8.8'])
      .mockResolvedValueOnce(['8.8.4.4']);
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(redirectResponse('https://other.example.com/final'))
      .mockResolvedValueOnce(htmlResponse('<html>final</html>'));

    const result = await secureFetch('https://example.com/recipe', {
      resolveDns,
      fetchImpl,
      allowedContentTypePrefixes: ['text/html'],
    });

    expect(result.finalUrl).toBe('https://other.example.com/final');
    expect(resolveDns).toHaveBeenNthCalledWith(1, 'example.com');
    expect(resolveDns).toHaveBeenNthCalledWith(2, 'other.example.com');
  });

  it('resolves a relative redirect Location against the current URL', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(redirectResponse('/final-page'))
      .mockResolvedValueOnce(htmlResponse('<html>final</html>'));

    const result = await secureFetch('https://example.com/recipe', {
      resolveDns: PUBLIC_DNS,
      fetchImpl,
      allowedContentTypePrefixes: ['text/html'],
    });

    expect(result.finalUrl).toBe('https://example.com/final-page');
  });

  it('rejects a redirect that points at a private/internal address, even after the origin passed', async () => {
    const resolveDns = jest
      .fn()
      .mockResolvedValueOnce(['8.8.8.8'])
      .mockResolvedValueOnce(['127.0.0.1']);
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(redirectResponse('https://internal.example.com/steal'));

    await expect(
      secureFetch('https://example.com/recipe', {
        resolveDns,
        fetchImpl,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'private_address' });
  });

  it('rejects a redirect chain longer than maxRedirects', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(redirectResponse('https://example.com/hop1'))
      .mockResolvedValueOnce(redirectResponse('https://example.com/hop2'))
      .mockResolvedValueOnce(redirectResponse('https://example.com/hop3'));

    await expect(
      secureFetch('https://example.com/recipe', {
        resolveDns: PUBLIC_DNS,
        fetchImpl,
        maxRedirects: 2,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'too_many_redirects' });
  });

  it('rejects an unexpected content-type without an allowed prefix', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );

    await expect(
      secureFetch('https://example.com/recipe', {
        resolveDns: PUBLIC_DNS,
        fetchImpl,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'unexpected_content_type' });
  });

  it('rejects a non-2xx, non-redirect HTTP status', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('nope', { status: 404 }));

    await expect(
      secureFetch('https://example.com/recipe', {
        resolveDns: PUBLIC_DNS,
        fetchImpl,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'http_error' });
  });

  it('rejects a response that exceeds the byte cap while streaming', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(600));
        controller.close();
      },
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }),
      );

    await expect(
      secureFetch('https://example.com/recipe', {
        resolveDns: PUBLIC_DNS,
        fetchImpl,
        maxBytes: 1000,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
  });

  it('times out a fetch that never resolves', async () => {
    const fetchImpl = jest.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    await expect(
      secureFetch('https://example.com/recipe', {
        resolveDns: PUBLIC_DNS,
        fetchImpl,
        timeoutMs: 10,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('is an instance of SecureFetchError on rejection', async () => {
    await expect(
      secureFetch('not-a-url', {
        resolveDns: PUBLIC_DNS,
        allowedContentTypePrefixes: ['text/html'],
      }),
    ).rejects.toBeInstanceOf(SecureFetchError);
  });
});
