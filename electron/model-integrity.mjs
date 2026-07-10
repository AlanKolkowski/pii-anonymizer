// Runtime integrity gate for the NER/OCR models (SECURITY.md §12a,
// THREAT-MODEL.md §4 S1, SECURITY-FIXES.md B1).
//
// SECURITY-REVIEW: trust model. Models live in resources/models/ — OUTSIDE
// app.asar (electron-builder.yml `extraResources`), because they are large,
// read-only blobs streamed straight from disk by the app:// protocol handler.
// That means the `EnableEmbeddedAsarIntegrityValidation` fuse does NOT cover
// them: it only protects app.asar's own contents. A Z4-class attacker (code
// execution as the current user, no admin) who can write to resources/models/
// could otherwise swap model_quantized.onnx for one that detects nothing —
// a silent fail-open where the UI looks normal, the network-block counter
// still reads zero, and the user pastes "anonymized" text that still carries
// a PESEL.
//
// The expected checksums (the anchor) are therefore copied into app.asar
// instead of sitting next to the models (electron-builder.yml `files`:
// models/manifest.json -> manifest.json at the asar root). An attacker
// who can rewrite a model file cannot also rewrite the anchor without either
// defeating asar integrity validation or writing inside app.asar, which a
// non-admin process on a perMachine install (SECURITY-FIXES.md B3) cannot do.
// Never move the anchor back next to the models — that lets one write
// replace both the data and the reference it's checked against.
//
// Fail-closed: a missing model, a size/hash mismatch, or a missing/unreadable/
// empty anchor are ALL treated as tampering. There is no "skip verification"
// path. Models are hundreds of MB each, so hashing always streams
// (createReadStream) and never buffers a whole file into memory.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export class ModelIntegrityError extends Error {}

/** Reads and validates the anchor manifest. Throws ModelIntegrityError, never returns a partial/unusable manifest. */
export function readAnchorManifest(anchorPath) {
  if (!existsSync(anchorPath)) {
    throw new ModelIntegrityError(`Brak kotwicy integralności modeli: ${anchorPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(anchorPath, 'utf8'));
  } catch (err) {
    throw new ModelIntegrityError(`Nieczytelna kotwica integralności modeli (${anchorPath}): ${err.message}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new ModelIntegrityError(`Kotwica integralności modeli nie zawiera wpisów: ${anchorPath}`);
  }
  return manifest;
}

/** Streams a file through SHA-256. Never reads the whole file into memory (models run to hundreds of MB). */
export function sha256OfFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/**
 * Verifies every file listed in the anchor manifest against modelsRoot.
 * Returns `{ ok: true }` or `{ ok: false, problems: string[] }` — never
 * throws for a verification mismatch (only for a fatal I/O surprise while
 * hashing, which is reported as a problem, not swallowed).
 */
export async function verifyModelIntegrity({ anchorPath, modelsRoot }) {
  let manifest;
  try {
    manifest = readAnchorManifest(anchorPath);
  } catch (err) {
    return { ok: false, problems: [err.message] };
  }

  const problems = [];
  for (const file of manifest.files) {
    const abs = join(modelsRoot, file.path);
    if (!existsSync(abs)) {
      problems.push(`brak pliku: ${file.path}`);
      continue;
    }
    const size = statSync(abs).size;
    if (size !== file.sizeBytes) {
      problems.push(`zły rozmiar ${file.path}: ${size} B, oczekiwano ${file.sizeBytes} B`);
      continue;
    }
    let digest;
    try {
      digest = await sha256OfFile(abs);
    } catch (err) {
      problems.push(`błąd odczytu ${file.path}: ${err.message}`);
      continue;
    }
    if (digest !== file.sha256) {
      problems.push(`zła suma SHA-256 ${file.path}: ${digest.slice(0, 16)}… ≠ ${file.sha256.slice(0, 16)}…`);
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
