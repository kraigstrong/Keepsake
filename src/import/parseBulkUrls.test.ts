import { parseBulkUrls } from './parseBulkUrls';

describe('parseBulkUrls', () => {
  it('splits one URL per line', () => {
    expect(parseBulkUrls('https://example.com/a\nhttps://example.com/b')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('tolerates blank lines and extra whitespace', () => {
    expect(parseBulkUrls('\n\n  https://example.com/a  \n\n\nhttps://example.com/b\n')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('splits URLs separated by spaces on the same line', () => {
    expect(parseBulkUrls('https://example.com/a https://example.com/b')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('drops non-URL tokens rather than throwing', () => {
    expect(parseBulkUrls('here are some recipes:\nhttps://example.com/a\nthanks!')).toEqual([
      'https://example.com/a',
    ]);
  });

  it('dedupes repeated URLs, keeping first-seen order', () => {
    expect(
      parseBulkUrls('https://example.com/a\nhttps://example.com/b\nhttps://example.com/a'),
    ).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('accepts both http and https', () => {
    expect(parseBulkUrls('http://example.com/a\nhttps://example.com/b')).toEqual([
      'http://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(parseBulkUrls('')).toEqual([]);
    expect(parseBulkUrls('   \n\n  ')).toEqual([]);
  });

  it('rejects a bare domain without a scheme', () => {
    expect(parseBulkUrls('example.com/recipe')).toEqual([]);
  });
});
