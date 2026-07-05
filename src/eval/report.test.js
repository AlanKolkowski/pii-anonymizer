import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildAnnotatedText, classifyEntities, humanizeDocName,
  ENTITY_COLORS, buildLegend,
  buildComparisonTable, formatDelta,
  generateReport,
  buildSegmentationSection,
} from './report.js';
import { NEQ_DELTA_HTML } from './enabled-entities.js';

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
      { entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.95, source: 'wjarka/eu-pii-anonimization-multilang' },
      { entity_group: 'EMAIL_ADDRESS', start: 60, end: 80, score: 1.0, source: 'regex' },
      { entity_group: 'LOCATION', start: 40, end: 50, score: 0.9, source: 'wjarka/eu-pii-anonimization-pl' },
    ];
    const result = classifyEntities(expected, predicted);

    const tp = result.find(e => e.status === 'tp');
    expect(tp.source).toBe('wjarka/eu-pii-anonimization-multilang');

    const fp = result.find(e => e.status === 'fp');
    expect(fp.source).toBe('regex');

    const mismatch = result.find(e => e.status === 'mismatch');
    expect(mismatch.source).toBe('wjarka/eu-pii-anonimization-pl');

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
      { start: 6, end: 16, entity_group: 'PERSON_NAME', status: 'tp', score: 0.95, source: 'wjarka/eu-pii-anonimization-multilang' },
    ];
    const html = buildAnnotatedText(text, spans);
    expect(html).toContain('<sup class="src"');
    expect(html).toContain('¹');
  });

  it('concatenates markers when source is an array (merged entity)', () => {
    const text = 'Jan Kowalski mieszka w Krakowie';
    const spans = [
      { start: 0, end: 13, entity_group: 'POSTAL_ADDRESS', status: 'tp', score: 0.9, source: ['wjarka/eu-pii-anonimization-multilang', 'wjarka/eu-pii-anonimization-pl'] },
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

  it('escapes fixture-derived document names in generated report HTML', async () => {
    const runId = `vitest-report-xss-${process.pid}`;
    const runDir = join(import.meta.dirname, '../../test-data/results', runId);
    const attackDoc = 'pismo_01_"><img src=x onerror=alert(1)>';
    const scoresData = {
      overall: { f1: 1, precision: 1, recall: 1, byType: {} },
      documents: {
        [attackDoc]: { f1: 1, precision: 1, recall: 1, byType: {} },
      },
    };

    await rm(runDir, { recursive: true, force: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'summary.json'), JSON.stringify({ label: 'xss-repro' }), 'utf-8');

    try {
      const reportPath = await generateReport(runId, scoresData);
      const html = await readFile(reportPath, 'utf-8');

      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).not.toContain(`data-doc="${attackDoc}"`);
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
  it('prefers scores.enabledEntities over summary.enabledEntities in the comparison table', async () => {
    const pid = process.pid;
    const prevRunId = `zzz-vitest-report-ee-${pid}`;
    const curRunId = `vitest-report-ee-${pid}`;
    const prevDir = join(import.meta.dirname, '../../test-data/results', prevRunId);
    const curDir = join(import.meta.dirname, '../../test-data/results', curRunId);
    const full = ['PERSON_NAME', 'ADDRESS', 'DATE'];
    const subset = ['PERSON_NAME'];

    // Historical run: scores.json carries a subset; summary.json the full set.
    const prevScores = {
      overall: { f1: 0.70, precision: 0.70, recall: 0.70, byType: {} },
      enabledEntities: subset,
      documents: {},
    };
    const scoresData = {
      overall: { f1: 0.90, precision: 0.90, recall: 0.90, byType: {} },
      enabledEntities: full,
      documents: {},
    };

    await rm(prevDir, { recursive: true, force: true });
    await rm(curDir, { recursive: true, force: true });
    await mkdir(prevDir, { recursive: true });
    await mkdir(curDir, { recursive: true });
    await writeFile(join(prevDir, 'scores.json'), JSON.stringify(prevScores), 'utf-8');
    await writeFile(join(prevDir, 'summary.json'), JSON.stringify({ label: 'ee-prev', enabledEntities: full }), 'utf-8');
    await writeFile(join(curDir, 'summary.json'), JSON.stringify({ label: 'ee-cur', enabledEntities: full }), 'utf-8');

    try {
      const reportPath = await generateReport(curRunId, scoresData);
      const html = await readFile(reportPath, 'utf-8');
      // Precedence resolves the historical run to the scores subset; it differs
      // from the current run's full set, so deltas are misleading → ≠types.
      expect(html).toContain(NEQ_DELTA_HTML);
    } finally {
      await rm(prevDir, { recursive: true, force: true });
      await rm(curDir, { recursive: true, force: true });
    }
  });
});

describe('buildSegmentationSection', () => {
  const text = 'Alpha. Beta gamma. Delta epsilon.';
  // 0          7          19
  // Alpha. Beta gamma. Delta epsilon.

  it('renders an empty placeholder when no expected segments are available', () => {
    const html = buildSegmentationSection(text, null, [], null);
    expect(html).toMatch(/No.*expected-segments\.json/);
  });

  it('renders segment blocks and metrics when both are provided', () => {
    const expected = [
      { start: 0, end: 6, text: 'Alpha.' },
      { start: 7, end: 18, text: 'Beta gamma.' },
      { start: 19, end: 33, text: 'Delta epsilon.' },
    ];
    const predicted = [
      { start: 0, end: 6, text: 'Alpha.' },
      { start: 7, end: 18, text: 'Beta gamma.' },
      // third expected segment missed entirely
    ];
    const metrics = { precision: 1, recall: 2/3, f1: 0.8, tp: 2, fp: 0, fn: 1, tpPartial: 0 };
    const html = buildSegmentationSection(text, expected, predicted, metrics);
    expect(html).toContain('class="segment');
    expect(html).toContain('boundary-marker missed'); // the missing third segment's boundary
    expect(html).toMatch(/F1.*?80\.0%/s);
  });

  it('renders orange caret for an extra predicted boundary', () => {
    const expected = [
      { start: 0, end: 33, text: 'Alpha. Beta gamma. Delta epsilon.' },
    ];
    const predicted = [
      { start: 0, end: 6, text: 'Alpha.' },
      { start: 7, end: 33, text: 'Beta gamma. Delta epsilon.' },
    ];
    const metrics = { precision: 0, recall: 0, f1: 0, tp: 0, fp: 2, fn: 1, tpPartial: 0 };
    const html = buildSegmentationSection(text, expected, predicted, metrics);
    expect(html).toContain('boundary-marker extra');
  });
});
