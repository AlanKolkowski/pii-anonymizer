import { describeOrigin } from './network-guard.mjs';

// Blocked-request logging must never leak PII: document text or entity
// values could ride in a URL's path or query string. describeOrigin() is the
// only thing standing between a blocked request and the log
// (SECURITY-FIXES.md S-LOG-1, checklist C-PERS-7).
describe('describeOrigin', () => {
  it('strips path, query and fragment from special-scheme URLs', () => {
    expect(describeOrigin('https://evil.com/exfiltrate?pesel=80010112345')).toBe('https://evil.com');
    expect(describeOrigin('http://example.com:8080/a/b?c=d#e')).toBe('http://example.com:8080');
  });

  it('never returns a host or path for non-special schemes like app:', () => {
    // Node's URL reports origin 'null' for app:, so only the scheme survives
    // — this must never regress into leaking the app:// host or path.
    expect(describeOrigin('app://app/tool.html?debug=1')).toBe('app://');
  });

  it('falls back to a fixed string for unparseable input', () => {
    expect(describeOrigin('not a url')).toBe('unparseable-url');
  });
});
