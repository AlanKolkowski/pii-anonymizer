import { describe, it, expect } from 'vitest';
import { tightenSegment, tightenSegmentsStep } from './tighten-segments.js';

function makeCtx(text, segments) {
  return { text, segments, entities: [], anonymized: '', legend: {} };
}

function assertSliceInvariant(source, segments) {
  for (const s of segments) {
    expect(source.slice(s.offset, s.offset + s.text.length)).toBe(s.text);
  }
}

describe('tightenSegment', () => {
  it('returns null for whitespace-only segment', () => {
    expect(tightenSegment({ text: '\n\n', offset: 10 })).toBeNull();
    expect(tightenSegment({ text: '   \t  ', offset: 0 })).toBeNull();
  });

  it('returns null for segment with no letters or digits', () => {
    expect(tightenSegment({ text: '========', offset: 0 })).toBeNull();
    expect(tightenSegment({ text: '───────\n───────', offset: 0 })).toBeNull();
  });

  it('trims leading whitespace on first line', () => {
    const seg = { text: '                              WEZWANIE DO ZAPŁATY', offset: 855 };
    const out = tightenSegment(seg);
    expect(out).toEqual({ text: 'WEZWANIE DO ZAPŁATY', offset: 885 });
  });

  it('trims trailing whitespace on last line', () => {
    const seg = { text: 'Kancelaria pragnie przypomnieć. ', offset: 100 };
    const out = tightenSegment(seg);
    expect(out).toEqual({ text: 'Kancelaria pragnie przypomnieć.', offset: 100 });
  });

  it('drops leading and trailing noise lines in a banner block', () => {
    const text = [
      '================================',
      'KANCELARIA PRAWNA NOWAK',
      'ul. Marszałkowska 47/12',
      '================================',
    ].join('\n');
    const seg = { text, offset: 0 };
    const out = tightenSegment(seg);
    expect(out.text).toBe('KANCELARIA PRAWNA NOWAK\nul. Marszałkowska 47/12');
    expect(out.offset).toBe(33);
  });

  it('preserves internal noise lines', () => {
    const text = 'Line A\n────\nLine B';
    const seg = { text, offset: 0 };
    const out = tightenSegment(seg);
    expect(out).toEqual({ text, offset: 0 });
  });

  it('preserves the text === source.slice(offset, offset+len) invariant', () => {
    const source = '  \n  HELLO\n  WORLD  \n\n';
    const seg = { text: source, offset: 0 };
    const out = tightenSegment(seg);
    expect(source.slice(out.offset, out.offset + out.text.length)).toBe(out.text);
  });
});

describe('tightenSegmentsStep', () => {
  it('drops whitespace-only and separator-only segments', () => {
    const text = 'A\n\n====\n\nB';
    const segments = [
      { text: 'A', offset: 0 },
      { text: '\n\n', offset: 1 },
      { text: '====', offset: 3 },
      { text: '\n\n', offset: 7 },
      { text: 'B', offset: 9 },
    ];
    const result = tightenSegmentsStep(makeCtx(text, segments));
    expect(result.segments).toEqual([
      { text: 'A', offset: 0 },
      { text: 'B', offset: 9 },
    ]);
    assertSliceInvariant(text, result.segments);
  });

  it('is a no-op on empty segments', () => {
    const ctx = makeCtx('hello', []);
    expect(tightenSegmentsStep(ctx).segments).toEqual([]);
  });

  it('tightens indented block and preserves source mapping', () => {
    const source = '  Numer rachunku: PL 62\n  Bank: Bank Zachodni\n  ';
    const segments = [{ text: source, offset: 100 }];
    const ctx = { text: 'x'.repeat(100) + source, segments, entities: [], anonymized: '', legend: {} };
    const result = tightenSegmentsStep(ctx);
    expect(result.segments).toEqual([
      { text: 'Numer rachunku: PL 62\n  Bank: Bank Zachodni', offset: 102 },
    ]);
    assertSliceInvariant(ctx.text, result.segments);
  });
});
