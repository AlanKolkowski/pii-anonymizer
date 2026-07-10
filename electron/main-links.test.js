import { EXTERNAL_LINK_ALLOWLIST, isAllowedExternalLink } from './main-links.mjs';

// shell.openExternal is the app's only path to the internet (SECURITY.md §5),
// so this allowlist is a security boundary, not a convenience.
describe('isAllowedExternalLink', () => {
  it('accepts every allow-listed URL verbatim', () => {
    for (const url of EXTERNAL_LINK_ALLOWLIST) {
      expect(isAllowedExternalLink(url), url).toBe(true);
    }
  });

  it('rejects sub-paths of allow-listed URLs (a path carries data too)', () => {
    expect(isAllowedExternalLink('https://github.com/wjarka/pii-anonymizer/PESEL80010112345')).toBe(false);
    expect(isAllowedExternalLink('https://nodejs.org/en/download')).toBe(false);
    expect(isAllowedExternalLink('https://bards.ai/leak/secret')).toBe(false);
  });

  it('rejects look-alike paths that merely share a prefix', () => {
    expect(isAllowedExternalLink('https://github.com/wjarka/pii-anonymizer-EVIL')).toBe(false);
    expect(isAllowedExternalLink('https://github.com/wjarka/pii-anonymizerXYZ')).toBe(false);
  });

  it('rejects URLs that could carry data out', () => {
    expect(isAllowedExternalLink('https://nodejs.org/?d=PESEL80010112345')).toBe(false);
    expect(isAllowedExternalLink('https://github.com/wjarka/pii-anonymizer?d=secret')).toBe(false);
    expect(isAllowedExternalLink('https://nodejs.org/#PESEL80010112345')).toBe(false);
    expect(isAllowedExternalLink('https://user:pass@nodejs.org/')).toBe(false);
  });

  it('rejects other origins and non-https schemes', () => {
    expect(isAllowedExternalLink('https://evil.com/')).toBe(false);
    expect(isAllowedExternalLink('https://github.com.evil.com/wjarka/pii-anonymizer')).toBe(false);
    expect(isAllowedExternalLink('http://github.com/wjarka/pii-anonymizer')).toBe(false);
    expect(isAllowedExternalLink('file:///C:/Windows/System32')).toBe(false);
    expect(isAllowedExternalLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalLink('not a url')).toBe(false);
  });

  it('every allow-listed entry is itself https, query-free and credential-free', () => {
    for (const raw of EXTERNAL_LINK_ALLOWLIST) {
      const url = new URL(raw);
      expect(url.protocol, raw).toBe('https:');
      expect(url.search, raw).toBe('');
      expect(url.username, raw).toBe('');
    }
  });
});
