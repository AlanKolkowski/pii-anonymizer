import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderReport } from './viewer.js';
import { NEQ_DELTA_HTML } from './enabled-entities.js';

describe('eval viewer', () => {
  it('escapes fixture-derived document names in rendered report HTML', async () => {
    const runId = `vitest-viewer-xss-${process.pid}`;
    const runDir = join(import.meta.dirname, '../../test-data/results', runId);
    const attackDoc = 'pismo_01_"><img src=x onerror=alert(1)>';
    const scores = {
      overall: { f1: 1, precision: 1, recall: 1, byType: {} },
      documents: {
        [attackDoc]: { f1: 1, precision: 1, recall: 1, byType: {} },
      },
    };

    await rm(runDir, { recursive: true, force: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'scores.json'), JSON.stringify(scores), 'utf-8');
    await writeFile(join(runDir, 'summary.json'), JSON.stringify({ label: 'viewer-xss' }), 'utf-8');

    try {
      const { html } = await renderReport([runId], runId);

      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).not.toContain(`data-doc="${attackDoc}"`);
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
  it('prefers scores.enabledEntities over summary.enabledEntities (subset vs full → ≠types)', async () => {
    const pid = process.pid;
    const aId = `vitest-viewer-ee-a-${pid}`;
    const bId = `vitest-viewer-ee-b-${pid}`;
    const aDir = join(import.meta.dirname, '../../test-data/results', aId);
    const bDir = join(import.meta.dirname, '../../test-data/results', bId);
    const full = ['PERSON_NAME', 'ADDRESS', 'DATE'];
    const subset = ['PERSON_NAME'];

    const aScores = {
      overall: { f1: 0.80, precision: 0.80, recall: 0.80, byType: {} },
      enabledEntities: full,
      documents: { doc1: { f1: 0.80, precision: 0.80, recall: 0.80, byType: {} } },
    };
    const bScores = {
      overall: { f1: 0.90, precision: 0.90, recall: 0.90, byType: {} },
      enabledEntities: subset,
      documents: { doc1: { f1: 0.90, precision: 0.90, recall: 0.90, byType: {} } },
    };

    await rm(aDir, { recursive: true, force: true });
    await rm(bDir, { recursive: true, force: true });
    await mkdir(aDir, { recursive: true });
    await mkdir(bDir, { recursive: true });
    await writeFile(join(aDir, 'scores.json'), JSON.stringify(aScores), 'utf-8');
    await writeFile(join(aDir, 'summary.json'), JSON.stringify({ label: 'ee-base', enabledEntities: full }), 'utf-8');
    await writeFile(join(bDir, 'scores.json'), JSON.stringify(bScores), 'utf-8');
    await writeFile(join(bDir, 'summary.json'), JSON.stringify({ label: 'ee-cur', enabledEntities: full }), 'utf-8');

    try {
      // A is baseline (full set); B resolves to its scores subset under the fix.
      const { html } = await renderReport([aId, bId], aId);
      expect(html).toContain(NEQ_DELTA_HTML);
    } finally {
      await rm(aDir, { recursive: true, force: true });
      await rm(bDir, { recursive: true, force: true });
    }
  });
});
