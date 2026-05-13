import { resolvePublicAssetUrl } from './models.js';

describe('resolvePublicAssetUrl', () => {
  it('uses absolute Vite base paths as-is', () => {
    expect(resolvePublicAssetUrl('ocr-models/model.tar', { base: '/pii-anonymizer/' }))
      .toBe('/pii-anonymizer/ocr-models/model.tar');
  });

  it('resolves relative builds against the Cloudflare Pages document URL', () => {
    expect(resolvePublicAssetUrl('ocr-models/model.tar', {
      base: './',
      documentBase: 'https://pii-anonymizer.pages.dev/tool.html',
    })).toBe('https://pii-anonymizer.pages.dev/ocr-models/model.tar');
  });

  it('resolves relative builds against the GitHub Pages document URL', () => {
    expect(resolvePublicAssetUrl('ocr-models/model.tar', {
      base: './',
      documentBase: 'https://wjarka.github.io/pii-anonymizer/tool.html',
    })).toBe('https://wjarka.github.io/pii-anonymizer/ocr-models/model.tar');
  });

  it('can infer the app root from a bundled worker URL', () => {
    expect(resolvePublicAssetUrl('ocr-models/model.tar', {
      base: './',
      locationHref: 'https://wjarka.github.io/pii-anonymizer/assets/worker-entry.js',
    })).toBe('https://wjarka.github.io/pii-anonymizer/ocr-models/model.tar');
  });
});
