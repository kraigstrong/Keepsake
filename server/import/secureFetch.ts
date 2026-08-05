/**
 * SSRF-hardened fetch (ADR-0015 decision 2, prd.md §30, threat-model.md
 * T6) — rejects a URL whose hostname is a raw IP literal outright, then
 * resolves DNS and rejects if any resolved address is private/loopback/
 * link-local/multicast/reserved, repeating the full check on every
 * redirect hop before following it (a redirect to an internal address
 * after the origin passed validation is exactly the attack this guards
 * against). Bounded by a byte cap, an overall timeout, and a
 * content-type allowlist.
 *
 * DNS resolution is an injected dependency, not a direct
 * `Deno.resolveDns`/Node `dns` call: this file has to run unchanged in
 * both the Jest 'server' project (no Deno global) and the Deno Edge
 * Function (no Node `dns` module) — see ADR-0015 decision 5. The Edge
 * Function entrypoint supplies the real resolver; tests inject a fake
 * one to simulate private-IP and redirect-to-internal scenarios
 * deterministically.
 *
 * Named residual risk (ADR-0015 decision 2): the DNS-resolution check
 * below and the actual `fetch()` call are two separate operations —
 * `fetch()` does its own internal DNS resolution at connect time, which
 * this code cannot force onto the specific IPs already validated here.
 * A DNS answer that changes between our check and `fetch()`'s own lookup
 * (DNS rebinding) is not fully closed by this design; that needs raw
 * socket control this foundation phase deliberately doesn't take on.
 *
 * Relies on the WHATWG URL parser's own canonicalization of obfuscated
 * IPv4 literals (hex/octal/decimal-integer forms like `2130706433` all
 * become `127.0.0.1` once parsed via `new URL(...)`, and IPv6 embedded
 * forms collapse to a canonical form) — `url.hostname` is checked
 * *after* parsing, so those obfuscation tricks are already neutralized
 * by the time this code inspects it.
 */

export class SecureFetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_scheme'
      | 'ip_literal_host'
      | 'private_address'
      | 'too_many_redirects'
      | 'timeout'
      | 'too_large'
      | 'unexpected_content_type'
      | 'http_error',
  ) {
    super(message);
    this.name = 'SecureFetchError';
  }
}

export interface SecureFetchOptions {
  resolveDns: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  allowedContentTypePrefixes: string[];
}

export interface SecureFetchResult {
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

const IPV4_BLOCKLIST: [base: string, prefixLength: number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // RFC 1918
  ['192.168.0.0', 16], // RFC 1918
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function isIpv4Blocked(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // unparseable — fail closed
  return IPV4_BLOCKLIST.some(([base, prefixLength]) => {
    const baseInt = ipv4ToInt(base)!;
    const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  });
}

function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip;
  const ipv4TailMatch = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (ipv4TailMatch) {
    const v4 = ipv4ToInt(ipv4TailMatch[1]!);
    if (v4 === null) return null;
    const hex = v4.toString(16).padStart(8, '0');
    addr =
      addr.slice(0, addr.length - ipv4TailMatch[1]!.length) + hex.slice(0, 4) + ':' + hex.slice(4);
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (s: string): string[] => (s.length === 0 ? [] : s.split(':'));
  let groups: string[];
  if (halves.length === 1) {
    groups = parseGroups(halves[0]!);
    if (groups.length !== 8) return null;
  } else {
    const head = parseGroups(halves[0]!);
    const tail = parseGroups(halves[1]!);
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8) return null;

  let result = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    result = (result << 16n) | BigInt(parseInt(g, 16));
  }
  return result;
}

function ipv6InRange(addr: bigint, base: bigint, prefixLength: number): boolean {
  const shift = 128n - BigInt(prefixLength);
  return addr >> shift === base >> shift;
}

const IPV4_MAPPED_PREFIX = ipv6ToBigInt('::ffff:0:0')!;

function isIpv6Blocked(ip: string): boolean {
  const addr = ipv6ToBigInt(ip);
  if (addr === null) return true; // unparseable — fail closed

  if (addr === 0n) return true; // ::  (unspecified)
  if (addr === 1n) return true; // ::1 (loopback)
  if (ipv6InRange(addr, ipv6ToBigInt('fe80::')!, 10)) return true; // link-local
  if (ipv6InRange(addr, ipv6ToBigInt('fc00::')!, 7)) return true; // unique local (private)
  if (ipv6InRange(addr, ipv6ToBigInt('ff00::')!, 8)) return true; // multicast

  if (ipv6InRange(addr, IPV4_MAPPED_PREFIX, 96)) {
    const low32 = Number(addr & 0xffffffffn);
    const dotted = [24, 16, 8, 0].map((shift) => (low32 >>> shift) & 0xff).join('.');
    return isIpv4Blocked(dotted);
  }

  return false;
}

// Exported for direct unit coverage of the CIDR/range logic (ADR-0015's
// "the fetcher is the most security-critical piece") — the higher-level
// secureFetch() tests exercise these indirectly too, but the bit-masking
// arithmetic here deserves granular fixture coverage on its own.
export function isPublicIp(ip: string): boolean {
  return ip.includes(':') ? !isIpv6Blocked(ip) : !isIpv4Blocked(ip);
}

export function isIpLiteralHostname(hostname: string): boolean {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

async function validateUrlForFetch(
  rawUrl: string,
  resolveDns: (hostname: string) => Promise<string[]>,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SecureFetchError(`Not a valid URL: ${rawUrl}`, 'invalid_scheme');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SecureFetchError(`Unsupported scheme: ${url.protocol}`, 'invalid_scheme');
  }

  if (isIpLiteralHostname(url.hostname)) {
    throw new SecureFetchError(
      `Refusing to fetch a raw IP literal host: ${url.hostname}`,
      'ip_literal_host',
    );
  }

  const addresses = await resolveDns(url.hostname);
  if (addresses.length === 0) {
    throw new SecureFetchError(
      `DNS resolution returned no addresses for ${url.hostname}`,
      'private_address',
    );
  }
  for (const address of addresses) {
    if (!isPublicIp(stripBrackets(address))) {
      throw new SecureFetchError(
        `${url.hostname} resolves to a non-public address (${address})`,
        'private_address',
      );
    }
  }

  return url;
}

/**
 * Fetches a URL end-to-end: validates + DNS-checks the origin and every
 * redirect hop, enforces a byte cap and overall timeout, and requires
 * the final response's Content-Type to match one of
 * `allowedContentTypePrefixes` before the body is read.
 */
export async function secureFetch(
  url: string,
  options: SecureFetchOptions,
): Promise<SecureFetchResult> {
  const {
    resolveDns,
    fetchImpl = fetch,
    maxRedirects = 3,
    maxBytes = 2 * 1024 * 1024,
    timeoutMs = 10_000,
    allowedContentTypePrefixes,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = url;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const validatedUrl = await validateUrlForFetch(currentUrl, resolveDns);

      const response = await fetchImpl(validatedUrl.toString(), {
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new SecureFetchError(`Redirect response with no Location header`, 'http_error');
        }
        if (hop === maxRedirects) {
          throw new SecureFetchError(`Exceeded ${maxRedirects} redirects`, 'too_many_redirects');
        }
        currentUrl = new URL(location, validatedUrl).toString();
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new SecureFetchError(`Unexpected HTTP status ${response.status}`, 'http_error');
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!allowedContentTypePrefixes.some((prefix) => contentType.startsWith(prefix))) {
        throw new SecureFetchError(
          `Unexpected content-type: ${contentType || '(none)'}`,
          'unexpected_content_type',
        );
      }

      const bytes = await readBodyWithLimit(response, maxBytes);

      return { finalUrl: validatedUrl.toString(), contentType, bytes };
    }

    throw new SecureFetchError(`Exceeded ${maxRedirects} redirects`, 'too_many_redirects');
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof SecureFetchError)) {
      throw new SecureFetchError(`Fetch exceeded ${timeoutMs}ms timeout`, 'timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new SecureFetchError(`Response exceeded ${maxBytes} byte limit`, 'too_large');
    }
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SecureFetchError(`Response exceeded ${maxBytes} byte limit`, 'too_large');
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
