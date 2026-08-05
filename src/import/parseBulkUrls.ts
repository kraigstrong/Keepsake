export const MAX_BULK_IMPORT_URLS = 20;

/**
 * Turns a pasted block of text into a deduped list of http(s) URLs, in
 * the order they first appear. Splits on any whitespace (newlines,
 * spaces, tabs) rather than requiring one-per-line specifically — the
 * developer's chosen UX is a plain multi-line paste box, and a pasted
 * list can arrive with inconsistent formatting (extra blank lines, a
 * stray space-separated pair). Non-URL tokens (blank lines, notes a
 * user pasted alongside the links) are silently dropped rather than
 * surfaced as per-line errors — this is a convenience parser, not a
 * strict validator; the server is the actual authority on whether a
 * given URL is importable.
 */
export function parseBulkUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const token of text.split(/\s+/)) {
    if (!/^https?:\/\//i.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    urls.push(token);
  }

  return urls;
}
