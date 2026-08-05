/**
 * Finds the page's hero image URL to acquire for IMG-01 ("Store locally.
 * Do not hotlink."). Operates on the *original* fetched HTML, not
 * reduceHtmlToText's output — an Open Graph `<meta property="og:image">`
 * tag lives in `<head>`, which content reduction deliberately drops.
 *
 * Prefers `og:image` (present on the large majority of real recipe
 * sites and exactly the image the site itself nominates as
 * representative) and falls back to the first `<img>` tag anywhere in
 * the page. That fallback is a known, documented limitation — it can
 * grab a header logo instead of the recipe photo on a site with no
 * Open Graph tags — acceptable for a foundation phase, not silently
 * assumed perfect.
 */

function extractMetaContent(html: string, propertyValue: string): string | null {
  const metaTagPattern = /<meta\b[^>]*>/gi;
  const propertyPattern = new RegExp(`(?:property|name)\\s*=\\s*["']${propertyValue}["']`, 'i');
  const contentPattern = /content\s*=\s*["']([^"']*)["']/i;

  let match: RegExpExecArray | null;
  while ((match = metaTagPattern.exec(html))) {
    const tag = match[0];
    if (propertyPattern.test(tag)) {
      const contentMatch = contentPattern.exec(tag);
      if (contentMatch?.[1]) return contentMatch[1];
    }
  }
  return null;
}

function firstImgSrc(html: string): string | null {
  const match = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  return match?.[1] ?? null;
}

export function extractHeroImageUrl(html: string, baseUrl: string): string | null {
  const candidate = extractMetaContent(html, 'og:image') ?? firstImgSrc(html);
  if (!candidate) return null;

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}
