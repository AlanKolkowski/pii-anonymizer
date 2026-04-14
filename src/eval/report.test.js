import { describe, it, expect } from 'vitest';
import { buildAnnotatedText, classifyEntities, humanizeDocName } from './report.js';

describe('classifyEntities', () => {
  it('classifies matched entities as TP, unmatched expected as FN, unmatched predicted as FP', () => {
    const expected = [
      { entity_group: 'PERSON_NAME', start: 0, end: 10, text: 'John Smith' },
      { entity_group: 'LOCATION', start: 20, end: 30, text: 'New York' },
    ];
    const predicted = [
      { entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.95 },
      { entity_group: 'PHONE_NUMBER', start: 50, end: 60, score: 0.8 },
    ];
    const result = classifyEntities(expected, predicted);

    expect(result.filter(e => e.status === 'tp')).toHaveLength(1);
    expect(result.filter(e => e.status === 'fn')).toHaveLength(1);
    expect(result.filter(e => e.status === 'fp')).toHaveLength(1);
  });
});

describe('buildAnnotatedText', () => {
  it('wraps entity spans in <span> with correct attributes', () => {
    const text = 'Hello John Smith world';
    const spans = [
      { start: 6, end: 16, entity_group: 'PERSON_NAME', status: 'tp', score: 0.95 },
    ];
    const html = buildAnnotatedText(text, spans);

    expect(html).toContain('John Smith');
    expect(html).toContain('data-type="PERSON_NAME"');
    expect(html).toContain('data-status="tp"');
    expect(html).toContain('class="entity PERSON_NAME tp"');
    expect(html).toContain('Hello ');
    expect(html).toContain(' world');
  });

  it('HTML-escapes text content', () => {
    const text = '<script>alert("xss")</script>';
    const spans = [];
    const html = buildAnnotatedText(text, spans);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('handles multiple non-overlapping spans', () => {
    const text = 'Jan Kowalski mieszka w Krakowie';
    const spans = [
      { start: 0, end: 13, entity_group: 'PERSON_NAME', status: 'tp', score: 0.9 },
      { start: 23, end: 31, entity_group: 'LOCATION', status: 'fn', score: null },
    ];
    const html = buildAnnotatedText(text, spans);
    expect(html).toContain('data-type="PERSON_NAME"');
    expect(html).toContain('data-type="LOCATION"');
  });

  it('handles overlapping spans by splitting at boundaries', () => {
    const text = '0123456789';
    const spans = [
      { start: 2, end: 7, entity_group: 'PERSON_NAME', status: 'tp', score: 0.9 },
      { start: 5, end: 9, entity_group: 'LOCATION', status: 'fn', score: null },
    ];
    const html = buildAnnotatedText(text, spans);
    // Both types should appear in output
    expect(html).toContain('PERSON_NAME');
    expect(html).toContain('LOCATION');
  });
});

describe('humanizeDocName', () => {
  it('converts pismo_01_wezwanie_do_zaplaty to "01. Wezwanie do zaplaty"', () => {
    expect(humanizeDocName('pismo_01_wezwanie_do_zaplaty')).toBe('01. Wezwanie do zaplaty');
  });

  it('handles names without pismo_ prefix', () => {
    expect(humanizeDocName('02_umowa_najmu')).toBe('02. Umowa najmu');
  });

  it('handles names without number prefix', () => {
    expect(humanizeDocName('custom_test_document')).toBe('Custom test document');
  });
});
