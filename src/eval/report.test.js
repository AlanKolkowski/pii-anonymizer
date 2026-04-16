import { describe, it, expect } from 'vitest';
import {
  buildAnnotatedText, classifyEntities, humanizeDocName,
  ENTITY_COLORS, buildLegend,
  buildComparisonTable, formatDelta,
  generateReport,
} from './report.js';

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

  it('carries source from predicted entities into TP/FP/mismatch spans', () => {
    const expected = [
      { entity_group: 'PERSON_NAME', start: 0, end: 10, text: 'John Smith' },
      { entity_group: 'PERSON_NAME', start: 40, end: 50, text: 'Jane Doe' },
    ];
    const predicted = [
      { entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.95, source: 'bardsai/eu-pii-anonimization-multilang' },
      { entity_group: 'EMAIL_ADDRESS', start: 60, end: 80, score: 1.0, source: 'regex' },
      { entity_group: 'LOCATION', start: 40, end: 50, score: 0.9, source: 'bardsai/eu-pii-anonimization' },
    ];
    const result = classifyEntities(expected, predicted);

    const tp = result.find(e => e.status === 'tp');
    expect(tp.source).toBe('bardsai/eu-pii-anonimization-multilang');

    const fp = result.find(e => e.status === 'fp');
    expect(fp.source).toBe('regex');

    const mismatch = result.find(e => e.status === 'mismatch');
    expect(mismatch.source).toBe('bardsai/eu-pii-anonimization');

    const fn = result.find(e => e.status === 'fn');
    if (fn) expect(fn.source ?? null).toBeNull();
  });

  it('classifies overlapping entities with different types as mismatch', () => {
    const expected = [
      { entity_group: 'PERSON_NAME', start: 0, end: 10, text: 'John Smith' },
    ];
    const predicted = [
      { entity_group: 'LOCATION', start: 0, end: 10, score: 0.9 },
    ];
    const result = classifyEntities(expected, predicted);

    expect(result.filter(e => e.status === 'mismatch')).toHaveLength(1);
    const mismatch = result.find(e => e.status === 'mismatch');
    expect(mismatch.entity_group).toBe('LOCATION');
    expect(mismatch.expected_entity_group).toBe('PERSON_NAME');
    expect(result.filter(e => e.status === 'fn')).toHaveLength(0);
    expect(result.filter(e => e.status === 'fp')).toHaveLength(0);
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

  it('emits a <sup class="src"> marker for entities with a known source', () => {
    const text = 'Hello John Smith world';
    const spans = [
      { start: 6, end: 16, entity_group: 'PERSON_NAME', status: 'tp', score: 0.95, source: 'bardsai/eu-pii-anonimization-multilang' },
    ];
    const html = buildAnnotatedText(text, spans);
    expect(html).toContain('<sup class="src"');
    expect(html).toContain('¹');
  });

  it('concatenates markers when source is an array (merged entity)', () => {
    const text = 'Jan Kowalski mieszka w Krakowie';
    const spans = [
      { start: 0, end: 13, entity_group: 'POSTAL_ADDRESS', status: 'tp', score: 0.9, source: ['bardsai/eu-pii-anonimization-multilang', 'bardsai/eu-pii-anonimization'] },
    ];
    const html = buildAnnotatedText(text, spans);
    expect(html).toContain('¹²');
  });

  it('shows regex marker ʳ for regex-sourced entities', () => {
    const text = 'Email: a@b.pl done';
    const spans = [
      { start: 7, end: 12, entity_group: 'EMAIL_ADDRESS', status: 'tp', score: 1.0, source: 'regex' },
    ];
    const html = buildAnnotatedText(text, spans);
    expect(html).toContain('ʳ');
  });

  it('omits the <sup class="src"> marker when source is null or missing', () => {
    const text = 'Jan Kowalski here';
    const spans = [
      { start: 0, end: 12, entity_group: 'PERSON_NAME', status: 'fn', score: null, source: null },
    ];
    const html = buildAnnotatedText(text, spans);
    expect(html).not.toContain('<sup class="src"');
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

describe('ENTITY_COLORS', () => {
  it('has a color for PERSON_NAME', () => {
    expect(ENTITY_COLORS['PERSON_NAME']).toBeDefined();
  });

  it('has at least 15 entity type colors', () => {
    expect(Object.keys(ENTITY_COLORS).length).toBeGreaterThanOrEqual(15);
  });
});

describe('buildLegend', () => {
  it('generates a legend table with only types that appear in spans', () => {
    const spans = [
      { entity_group: 'PERSON_NAME', status: 'tp' },
      { entity_group: 'PERSON_NAME', status: 'fp' },
      { entity_group: 'LOCATION', status: 'fn' },
    ];
    const html = buildLegend(spans);
    expect(html).toContain('PERSON_NAME');
    expect(html).toContain('LOCATION');
    expect(html).not.toContain('PHONE_NUMBER');
    // TP count for PERSON_NAME
    expect(html).toContain('<td>1</td>');
  });
});

describe('formatDelta', () => {
  it('shows positive delta in green', () => {
    const html = formatDelta(0.85, 0.90);
    expect(html).toContain('+5.0pp');
    expect(html).toContain('delta-pos');
  });

  it('shows negative delta in red', () => {
    const html = formatDelta(0.90, 0.85);
    expect(html).toContain('-5.0pp');
    expect(html).toContain('delta-neg');
  });

  it('shows no change for tiny difference', () => {
    const html = formatDelta(0.90, 0.9004);
    expect(html).toContain('delta-zero');
  });
});

describe('buildComparisonTable', () => {
  it('renders a table with run columns and metric rows', () => {
    const runs = [
      { runId: 'baseline', label: 'baseline', f1: 0.80, precision: 0.75, recall: 0.85 },
      { runId: 'current', label: null, f1: 0.85, precision: 0.80, recall: 0.90 },
    ];
    const html = buildComparisonTable(runs, 'current');
    expect(html).toContain('baseline');
    expect(html).toContain('current');
    expect(html).toContain('80.0%');
    expect(html).toContain('85.0%');
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

describe('generateReport', () => {
  it('exports a function', () => {
    expect(typeof generateReport).toBe('function');
  });
});
