import { isSameOriginAsApp } from './nav-policy.mjs';

// will-navigate / will-redirect use this to decide whether to allow a
// navigation to proceed; a wrong answer is either a broken app (false
// negative) or a hole in the origin lockdown (false positive). SECURITY.md §5.
describe('isSameOriginAsApp', () => {
  const appOrigin = 'app://app';

  it('accepts the app origin itself, any path or query', () => {
    expect(isSameOriginAsApp('app://app/tool.html', { appOrigin })).toBe(true);
    expect(isSameOriginAsApp('app://app/index.html?x=1', { appOrigin })).toBe(true);
  });

  it('rejects everything else when no dev server is configured', () => {
    expect(isSameOriginAsApp('http://localhost:5183/', { appOrigin })).toBe(false);
    expect(isSameOriginAsApp('https://evil.com/', { appOrigin })).toBe(false);
  });

  it('accepts the dev server origin only when one is configured', () => {
    const devServerUrl = 'http://localhost:5183';
    expect(isSameOriginAsApp('http://localhost:5183/tool.html', { appOrigin, devServerUrl })).toBe(true);
  });

  it('rejects a look-alike host that merely shares a prefix (the S-NET-5 bug)', () => {
    const devServerUrl = 'http://localhost:5183';
    expect(isSameOriginAsApp('http://localhost:5183.evil.com/', { appOrigin, devServerUrl })).toBe(false);
    expect(isSameOriginAsApp('http://localhost:51830/', { appOrigin, devServerUrl })).toBe(false);
  });

  it('rejects a different scheme or port on an otherwise-matching host', () => {
    const devServerUrl = 'http://localhost:5183';
    expect(isSameOriginAsApp('https://localhost:5183/', { appOrigin, devServerUrl })).toBe(false);
    expect(isSameOriginAsApp('http://localhost:5184/', { appOrigin, devServerUrl })).toBe(false);
  });

  it('rejects unparseable URLs', () => {
    expect(isSameOriginAsApp('not a url', { appOrigin })).toBe(false);
    expect(isSameOriginAsApp('not a url', { appOrigin, devServerUrl: 'http://localhost:5183' })).toBe(false);
  });
});
