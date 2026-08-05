/**
 * Pure URL canonicalization (ADR-0015 decision 4) — no Node/Deno-specific
 * APIs, just the Web-standard URL/URLSearchParams both runtimes share, so
 * this file runs unchanged in the Deno Edge Function and stays
 * Jest-testable in Node.
 *
 * Two jobs: (1) reject anything that isn't a real http(s) URL up front —
 * the first, cheapest checkpoint for untrusted input (prd.md §30) before
 * this ever reaches the fetcher or an AI call; (2) produce a canonical
 * form two different-looking URLs for the same page collapse to, so
 * duplicate detection (comparing against recipes.source_url, normalized
 * the same way) isn't defeated by a stray tracking parameter or trailing
 * slash.
 */

const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_[ce]id$/i,
  /^igshid$/i,
  /^ref$/i,
  /^ref_src$/i,
];

export function normalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs can be imported');
  }

  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
      params.delete(key);
    }
  }
  url.search = new URLSearchParams(
    [...params.entries()].sort(([a], [b]) => a.localeCompare(b)),
  ).toString();

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}
