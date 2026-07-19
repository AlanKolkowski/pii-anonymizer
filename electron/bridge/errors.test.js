import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERRORS, toolErrorResult } from './errors.mjs';

// MOST-IMPL-PLAN.md §3 M6 (O-7): every message returned WITHOUT opening a
// gate must be a fixed, literal string — never document content, never a
// private label. The anti-interpolation test reads this module's own
// SOURCE TEXT and asserts it contains no `${` at all: every message here is
// fully static (none of the current closed-list errors need to embed a
// reqId or a count), so the strongest and simplest invariant is "no
// template substitution exists in this file, period". If a future message
// genuinely needs to interpolate an already-validated id or a number, that
// is a deliberate, reviewed change to both this file and this test —
// exactly the "przegląd listy = pozycja bramki" the design doc calls for.
const SOURCE = readFileSync(fileURLToPath(new URL('./errors.mjs', import.meta.url)), 'utf8');

describe('errors.mjs — closed list, anti-interpolation', () => {
  it('contains no template-literal substitution anywhere in the module source', () => {
    expect(SOURCE).not.toContain('${');
  });

  it('exposes every message as a frozen, non-empty, plain string', () => {
    expect(Object.isFrozen(ERRORS)).toBe(true);
    for (const [key, value] of Object.entries(ERRORS)) {
      expect(typeof value, `${key} must be a string`).toBe('string');
      expect(value.length, `${key} must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('none of the messages leak an obvious placeholder for document content or a private label', () => {
    for (const value of Object.values(ERRORS)) {
      expect(value).not.toMatch(/\[object|undefined|NaN/);
    }
  });
});

describe('toolErrorResult', () => {
  it('wraps a closed-list message in the exact CallToolResult error shape', () => {
    expect(toolErrorResult(ERRORS.USER_REJECTED)).toEqual({
      content: [{ type: 'text', text: ERRORS.USER_REJECTED }],
      isError: true,
    });
  });

  it('refuses to wrap a message that is not one of the closed-list values (no ad-hoc strings smuggled through)', () => {
    expect(() => toolErrorResult('coś zupełnie innego')).toThrow();
  });
});
