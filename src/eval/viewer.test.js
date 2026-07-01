import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderReport } from './viewer.js';

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
});
