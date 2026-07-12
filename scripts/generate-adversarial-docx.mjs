// Writes the adversarial DOCX fixtures (PII in tables, footnotes, page
// header and footer) to test-data/adversarial/docx/ for manual testing of
// the import path in the running app. The same builders are pinned by
// src/file-import/docx-adversarial.test.js; all data is fictional.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildTabelaPrzypisyDocx,
  buildNaglowekStopkaDocx,
  DOCX_TABELA_PRZYPISY,
  DOCX_NAGLOWEK_STOPKA,
} from '../src/docx-rebuild/test-helpers/docx-fixture.js';

const OUT_DIR = join(import.meta.dirname, '..', 'test-data', 'adversarial', 'docx');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const fixtures = [
    [DOCX_TABELA_PRZYPISY, buildTabelaPrzypisyDocx],
    [DOCX_NAGLOWEK_STOPKA, buildNaglowekStopkaDocx],
  ];
  for (const [meta, build] of fixtures) {
    const bytes = await build();
    await writeFile(join(OUT_DIR, `${meta.name}.docx`), bytes);
    console.log(`${meta.name}.docx (${bytes.byteLength} B) — ${meta.attack}`);
  }
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
