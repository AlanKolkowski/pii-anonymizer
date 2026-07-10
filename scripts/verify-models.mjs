// Build-time integrity gate for the embedded models.
//
// scripts/fetch-models.mjs writes models/manifest.json (sizes + SHA-256) only
// after every file lands. This script re-checks the tree against it, so an
// interrupted download can never be packaged into an installer that ships a
// truncated 279 MB ONNX file and dies at first classify.
//
// Also exports readModelManifest(), which makes manifest.json the single
// source of truth for the ONNX variant (dtype) — vite.config.electron.js
// reads it instead of a second, independently-set env var.
//
// Usage: node scripts/verify-models.mjs [--quick]   (--quick skips SHA-256)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MODELS_DIR = join(ROOT, 'models');
const MANIFEST_PATH = join(MODELS_DIR, 'manifest.json');

export class ModelVerificationError extends Error {}

/** Reads models/manifest.json, or throws with the exact remedy. */
export function readModelManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new ModelVerificationError(
      `Brak ${MANIFEST_PATH}.\nUruchom najpierw: npm run desktop:fetch-models`,
    );
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest.dtype || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new ModelVerificationError(`Uszkodzony manifest modeli: ${MANIFEST_PATH}`);
  }
  return manifest;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Walks models/ looking for leftovers from an aborted download. */
async function findPartFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findPartFiles(abs)));
    else if (entry.name.endsWith('.part')) out.push(abs);
  }
  return out;
}

export async function verifyModels({ quick = false, log = console.log } = {}) {
  const manifest = readModelManifest();

  const parts = await findPartFiles(MODELS_DIR);
  if (parts.length > 0) {
    throw new ModelVerificationError(
      `Niedokończone pobieranie modeli (pliki .part):\n${parts.join('\n')}\n\n`
      + 'Usuń je i uruchom ponownie: npm run desktop:fetch-models',
    );
  }

  const problems = [];
  for (const file of manifest.files) {
    const abs = join(MODELS_DIR, file.path);
    if (!existsSync(abs)) {
      problems.push(`brak pliku: ${file.path}`);
      continue;
    }
    const size = statSync(abs).size;
    if (size !== file.sizeBytes) {
      problems.push(`zły rozmiar ${file.path}: ${size} B, oczekiwano ${file.sizeBytes} B`);
      continue;
    }
    if (!quick) {
      const digest = sha256(abs);
      if (digest !== file.sha256) {
        problems.push(`zła suma SHA-256 ${file.path}: ${digest.slice(0, 16)}… ≠ ${file.sha256.slice(0, 16)}…`);
      }
    }
  }

  if (problems.length > 0) {
    throw new ModelVerificationError(
      `Weryfikacja modeli nie powiodła się (${problems.length}):\n- ${problems.join('\n- ')}\n\n`
      + 'Napraw: usuń models/ i uruchom ponownie: npm run desktop:fetch-models',
    );
  }

  log(`Modele OK: ${manifest.files.length} plików, dtype=${manifest.dtype}${quick ? ' (bez SHA-256)' : ', SHA-256 zgodne'}`);
  return manifest;
}

// CLI entry point: only when run directly, not when imported by the Vite config.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await verifyModels({ quick: process.argv.includes('--quick') });
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}
