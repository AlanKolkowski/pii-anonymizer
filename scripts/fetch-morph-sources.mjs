// W1 (W1-W3-MORPHOLOGY-DESIGN.md §1.3): TOFU fetcher for the morphology
// data sources. Dev-machine only — the app never downloads anything.
//
//   node scripts/fetch-morph-sources.mjs            # requires the lock; fail-closed
//   node scripts/fetch-morph-sources.mjs --anchor   # first anchoring: downloads,
//                                                   # PRINTS sha256 sums for human
//                                                   # review; committing the lock is
//                                                   # the explicit act of trust the
//                                                   # O-3 gate reviews
//
// NOTE (O-3): running this script is part of the GATED data path — the
// datasets (SGJP .tab under BSD-2, PESEL lists under CC0) do not enter the
// repo before the Opus gate reviews the lock, the extracted license files
// and the compile report (design §1.9). This session ships the CODE only.
//
// Trust comes from the anchored checksum in the repo and the post-compile
// data review — never from the transport channel (SGJP serves plain HTTP).
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = join(ROOT, 'scripts', 'morph-sources.lock.json');
const CACHE_DIR = join(ROOT, 'scripts', '.cache', 'morph');

// Pinned source URLs (design §1.1, stan na 2026-07-12). At anchor time the
// operator confirms these against the design and the source pages; the lock
// then carries them with checksums.
const SOURCES = {
  sgjp: {
    url: 'http://download.sgjp.pl/morfeusz/20260628/sgjp-20260628.tab.gz',
    filename: 'sgjp-20260628.tab.gz',
    license: 'BSD-2-Clause',
    licenseUrl: 'http://morfeusz.sgjp.pl/doc/license/',
  },
  'pesel-imiona': {
    url: 'https://api.dane.gov.pl/1.4/datasets/1667', // resource URL pinned at anchor time
    filename: 'pesel-imiona.csv',
    license: 'CC0-1.0',
    licenseUrl: 'https://dane.gov.pl/pl/dataset/1667',
  },
  'pesel-nazwiska': {
    url: 'https://api.dane.gov.pl/1.4/datasets/1681', // resource URL pinned at anchor time
    filename: 'pesel-nazwiska.csv',
    license: 'CC0-1.0',
    licenseUrl: 'https://dane.gov.pl/pl/dataset/1681',
  },
};

export async function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

async function download(url, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const tmp = `${destination}.download`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
  await rename(tmp, destination);
}

export async function readLock(lockPath = LOCK_PATH) {
  let raw;
  try {
    raw = await readFile(lockPath, 'utf-8');
  } catch {
    return null;
  }
  const lock = JSON.parse(raw);
  if (lock.version !== 1 || !lock.sources) throw new Error('morph-sources.lock.json: zły format');
  return lock;
}

export async function verifyAgainstLock(lock, cacheDir = CACHE_DIR) {
  for (const [name, entry] of Object.entries(lock.sources)) {
    const path = join(cacheDir, entry.filename);
    const actual = await sha256File(path).catch(() => null);
    if (actual === null) throw new Error(`morph: brak pliku ${entry.filename} w cache — uruchom fetch`);
    if (actual !== entry.sha256) {
      throw new Error(`morph: suma ${name} niezgodna z lockiem (fail-closed)\n  lock:   ${entry.sha256}\n  actual: ${actual}`);
    }
  }
}

async function main() {
  const anchor = process.argv.includes('--anchor');
  const lock = await readLock();

  if (!lock && !anchor) {
    console.error(
      'Brak scripts/morph-sources.lock.json.\n'
      + 'Pierwsze kotwiczenie to jawny, przeglądany akt zaufania (O-3):\n'
      + '  node scripts/fetch-morph-sources.mjs --anchor\n'
      + 'wypisze sumy sha256 do ręcznego przejrzenia i wklejenia do locka.\n'
      + 'Bez locka ten skrypt niczego nie weryfikuje, więc odmawia.',
    );
    process.exit(1);
  }

  if (anchor) {
    console.log('Tryb --anchor: pobieram źródła i wypisuję sumy do przeglądu.');
    const entries = {};
    for (const [name, source] of Object.entries(SOURCES)) {
      const destination = join(CACHE_DIR, source.filename);
      console.log(`\n${name}: ${source.url}`);
      await download(source.url, destination);
      const sha256 = await sha256File(destination);
      console.log(`  sha256: ${sha256}`);
      entries[name] = { ...source, sha256, anchoredAt: new Date().toISOString().slice(0, 10) };
    }
    console.log('\nPo przejrzeniu wklej do scripts/morph-sources.lock.json:');
    console.log(JSON.stringify({ version: 1, sources: entries }, null, 2));
    return;
  }

  for (const [name, entry] of Object.entries(lock.sources)) {
    const destination = join(CACHE_DIR, entry.filename);
    const existing = await sha256File(destination).catch(() => null);
    if (existing === entry.sha256) {
      console.log(`${name}: cache OK (${entry.sha256.slice(0, 12)}…)`);
      continue;
    }
    if (existing !== null) await rm(destination);
    console.log(`${name}: pobieram ${entry.url}`);
    await download(entry.url, destination);
    const actual = await sha256File(destination);
    if (actual !== entry.sha256) {
      await rm(destination);
      throw new Error(`morph: suma ${name} niezgodna z lockiem po pobraniu (fail-closed)\n  lock:   ${entry.sha256}\n  actual: ${actual}`);
    }
    console.log(`${name}: OK`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
