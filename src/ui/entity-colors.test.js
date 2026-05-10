// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  ENTITY_PALETTE,
  paletteVarsFor,
  applyPaletteVars,
  colorFor,
  FALLBACK_COLOR,
} from './entity-colors.js';

describe('paletteVarsFor', () => {
  it('returns CSS custom properties for known types', () => {
    const vars = paletteVarsFor('PERSON_NAME');
    expect(vars).not.toBeNull();
    expect(vars['--ec-bg']).toMatch(/^oklch\(/);
    expect(vars['--ec-ink']).toMatch(/^oklch\(/);
    expect(vars['--ec-line']).toMatch(/^oklch\(/);
  });

  it('returns null for unknown types', () => {
    expect(paletteVarsFor('NOT_A_REAL_TYPE')).toBeNull();
  });
});

describe('applyPaletteVars', () => {
  it('sets three CSS variables on the element style', () => {
    const el = document.createElement('span');
    applyPaletteVars(el, 'PERSON_NAME');
    expect(el.style.getPropertyValue('--ec-bg')).toMatch(/oklch/);
    expect(el.style.getPropertyValue('--ec-ink')).toMatch(/oklch/);
    expect(el.style.getPropertyValue('--ec-line')).toMatch(/oklch/);
  });

  it('does nothing for unknown types — CSS fallbacks then apply', () => {
    const el = document.createElement('span');
    applyPaletteVars(el, 'NOT_A_REAL_TYPE');
    expect(el.style.getPropertyValue('--ec-bg')).toBe('');
  });
});

describe('ENTITY_PALETTE', () => {
  it('every palette entry has bg/ink/line keys', () => {
    for (const [code, p] of Object.entries(ENTITY_PALETTE)) {
      expect(p, code).toMatchObject({ bg: expect.any(String), ink: expect.any(String), line: expect.any(String) });
    }
  });
});

describe('colorFor (legacy)', () => {
  it('still returns hex codes for backward compatibility', () => {
    expect(colorFor('PERSON_NAME')).toBe('#4CAF50');
    expect(colorFor('UNKNOWN')).toBe(FALLBACK_COLOR);
  });
});
