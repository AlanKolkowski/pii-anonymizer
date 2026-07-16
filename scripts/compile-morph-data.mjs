// W1 (W1-W3-MORPHOLOGY-DESIGN.md §1.4): CLI wrapper for the morphology
// compiler. Reads sources from scripts/.cache/morph/ ONLY after verifying
// their checksums against the anchored lock (fail-closed), compiles the
// artifact deterministically and writes:
//   src/verifier/morph/data/morph-pl.json
//   src/verifier/morph/data/COMPILE-REPORT.md
//
// NOTE (O-3): this is part of the GATED data path — running it requires the
// anchored lock and the downloaded datasets, both of which enter the repo
// only through the Opus gate (design §1.9). The compilation LOGIC is
// unit-tested on synthetic fixtures (scripts/morph/compile-core.test.mjs),
// so this wrapper stays thin.
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMorphData } from './morph/compile-core.mjs';
import { readLock, verifyAgainstLock } from './fetch-morph-sources.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'scripts', '.cache', 'morph');
const DATA_DIR = join(ROOT, 'src', 'verifier', 'morph', 'data');

async function readSource(filename) {
  const raw = await readFile(join(CACHE_DIR, filename));
  return filename.endsWith('.gz') ? gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');
}

async function main() {
  const lock = await readLock();
  if (!lock) {
    console.error('Brak scripts/morph-sources.lock.json — najpierw kotwiczenie (fetch --anchor) i bramka O-3.');
    process.exit(1);
  }
  await verifyAgainstLock(lock);

  const sgjpTab = await readSource(lock.sources.sgjp.filename);
  const imionaCsv = await readSource(lock.sources['pesel-imiona'].filename);
  const nazwiskaCsv = await readSource(lock.sources['pesel-nazwiska'].filename);

  const zrodla = Object.fromEntries(
    Object.entries(lock.sources).map(([name, s]) => [name, { filename: s.filename, sha256: s.sha256, license: s.license }]),
  );

  const { json, report } = compileMorphData({ sgjpTab, imionaCsv, nazwiskaCsv, zrodla });

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, 'morph-pl.json'), json, 'utf-8');
  await writeFile(join(DATA_DIR, 'COMPILE-REPORT.md'), report, 'utf-8');
  console.log(`Zapisano morph-pl.json (${json.length} B) i COMPILE-REPORT.md`);
  console.log('PR z regeneracją danych pokazuje diff raportu — to jest materiał przeglądowy.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
