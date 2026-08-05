import { normalizeUrl } from './normalizeUrl';

describe('normalizeUrl', () => {
  it('lowercases the scheme and host', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Recipe')).toBe('https://example.com/Recipe');
  });

  it('strips the default port for http and https', () => {
    expect(normalizeUrl('http://example.com:80/recipe')).toBe('http://example.com/recipe');
    expect(normalizeUrl('https://example.com:443/recipe')).toBe('https://example.com/recipe');
  });

  it('keeps a non-default port', () => {
    expect(normalizeUrl('https://example.com:8443/recipe')).toBe('https://example.com:8443/recipe');
  });

  it('strips the fragment', () => {
    expect(normalizeUrl('https://example.com/recipe#comments')).toBe('https://example.com/recipe');
  });

  it('drops a trailing slash except at the root', () => {
    expect(normalizeUrl('https://example.com/recipe/')).toBe('https://example.com/recipe');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('strips known tracking parameters', () => {
    const url =
      'https://example.com/recipe?utm_source=newsletter&utm_medium=email&fbclid=abc&gclid=xyz&mc_cid=1&mc_eid=2&igshid=3&ref=home&ref_src=twitter';
    expect(normalizeUrl(url)).toBe('https://example.com/recipe');
  });

  it('keeps non-tracking query parameters and sorts them', () => {
    expect(normalizeUrl('https://example.com/recipe?b=2&a=1')).toBe('https://example.com/recipe?a=1&b=2');
  });

  it('mixes tracking and non-tracking params correctly', () => {
    expect(normalizeUrl('https://example.com/recipe?utm_source=x&id=42')).toBe(
      'https://example.com/recipe?id=42',
    );
  });

  it('two differently-decorated URLs for the same page normalize identically', () => {
    const a = normalizeUrl('https://EXAMPLE.com/recipe/?utm_source=pinterest#save');
    const b = normalizeUrl('https://example.com:443/recipe?utm_campaign=fall');
    expect(a).toBe(b);
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow('Only http/https URLs can be imported');
    expect(() => normalizeUrl('ftp://example.com/recipe')).toThrow('Only http/https URLs can be imported');
    expect(() => normalizeUrl('mailto:someone@example.com')).toThrow('Only http/https URLs can be imported');
    expect(() => normalizeUrl('data:text/html,<script>1</script>')).toThrow(
      'Only http/https URLs can be imported',
    );
  });

  it('rejects a string that is not a URL at all', () => {
    expect(() => normalizeUrl('not a url')).toThrow('Not a valid URL');
    expect(() => normalizeUrl('')).toThrow('Not a valid URL');
  });
});
