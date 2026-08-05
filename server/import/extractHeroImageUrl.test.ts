import { extractHeroImageUrl } from './extractHeroImageUrl';

describe('extractHeroImageUrl', () => {
  it('prefers the og:image meta tag', () => {
    const html = `
      <html><head>
        <meta property="og:image" content="https://cdn.example.com/hero.jpg">
      </head><body><img src="/logo.png"></body></html>
    `;
    expect(extractHeroImageUrl(html, 'https://example.com/recipe')).toBe(
      'https://cdn.example.com/hero.jpg',
    );
  });

  it('handles attributes in either order', () => {
    const html = `<meta content="https://cdn.example.com/hero.jpg" property="og:image">`;
    expect(extractHeroImageUrl(html, 'https://example.com/recipe')).toBe(
      'https://cdn.example.com/hero.jpg',
    );
  });

  it('resolves a relative og:image URL against the page URL', () => {
    const html = `<meta property="og:image" content="/images/hero.jpg">`;
    expect(extractHeroImageUrl(html, 'https://example.com/recipe/roast-chicken')).toBe(
      'https://example.com/images/hero.jpg',
    );
  });

  it('accepts name="og:image" as well as property=', () => {
    const html = `<meta name="og:image" content="https://cdn.example.com/hero.jpg">`;
    expect(extractHeroImageUrl(html, 'https://example.com/recipe')).toBe(
      'https://cdn.example.com/hero.jpg',
    );
  });

  it('falls back to the first <img> tag when there is no og:image', () => {
    const html = `<html><body><p>text</p><img src="https://cdn.example.com/photo.jpg"></body></html>`;
    expect(extractHeroImageUrl(html, 'https://example.com/recipe')).toBe(
      'https://cdn.example.com/photo.jpg',
    );
  });

  it('resolves a relative <img> src against the page URL', () => {
    const html = `<img src="photo.jpg">`;
    expect(extractHeroImageUrl(html, 'https://example.com/recipes/chicken')).toBe(
      'https://example.com/recipes/photo.jpg',
    );
  });

  it('returns null when there is no og:image and no <img> tag', () => {
    const html = `<html><body><p>No images here.</p></body></html>`;
    expect(extractHeroImageUrl(html, 'https://example.com/recipe')).toBeNull();
  });

  it('does not itself filter a non-http(s) candidate URL', () => {
    const html = `<meta property="og:image" content="javascript:alert(1)">`;
    // A "javascript:" URL is technically parseable by new URL(), so it's
    // returned as-is here — the security boundary against it is
    // secureFetch's scheme check downstream, not this function, since
    // this function only locates a candidate URL, never fetches it.
    expect(extractHeroImageUrl(html, 'https://example.com/recipe')).toBe('javascript:alert(1)');
  });
});
