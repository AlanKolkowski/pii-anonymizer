// Downloads the NER + OCR models that the desktop (Electron) build embeds as
// extraResources. Dev-time only — the packaged app NEVER downloads anything.
//
// Layout produced (gitignored, consumed by electron-builder extraResources
// and by the desktop dev server middleware in vite.config.electron.js):
//
//   models/
//     manifest.json                  provenance: url, size, sha256 per file
//     ner/<hf-repo-id>/config.json
//     ner/<hf-repo-id>/tokenizer.json
//     ner/<hf-repo-id>/tokenizer_config.json
//     ner/<hf-repo-id>/onnx/model_quantized.onnx   (dtype-dependent suffix)
//     ocr/PP-OCRv5_mobile_det_onnx.tar
//     ocr/latin_PP-OCRv5_mobile_rec.tar
//
// Usage:
//   node scripts/fetch-models.mjs                 # default dtype q8 (INT8)
//   MODEL_DTYPE=fp16 node scripts/fetch-models.mjs
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = join(ROOT, 'models');
const MANIFEST_PATH = join(MODELS_DIR, 'manifest.json');

// Must stay in sync with DTYPE_SUFFIX in src/pipeline/model-download.js.
const DTYPE_SUFFIX = { fp32: '', fp16: '_fp16', int8: '_int8', q8: '_quantized' };
const DTYPE = process.env.MODEL_DTYPE || 'q8';
if (!(DTYPE in DTYPE_SUFFIX)) {
  console.error(`Unsupported MODEL_DTYPE "${DTYPE}". Supported: ${Object.keys(DTYPE_SUFFIX).join(', ')}`);
  process.exit(1);
}

// Same repos as SOURCES in src/pipeline/configs/entity-sources.js.
const NER_REPOS = [
  'wjarka/eu-pii-anonimization-pl',
  'wjarka/eu-pii-anonimization-multilang',
];
const NER_FILES = [
  'config.json',
  'tokenizer_config.json',
  'tokenizer.json',
  `onnx/model${DTYPE_SUFFIX[DTYPE]}.onnx`,
];

// Same URL as TEXT_DETECTION_MODEL_URL in src/ocr/models.js.
const OCR_DET_URL = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx.tar';
const OCR_REC_LOCAL = join(ROOT, 'public', 'ocr-models', 'latin_PP-OCRv5_mobile_rec.tar');

function hfUrl(repo, file) {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

async function download(url, dest, label) {
  const existing = await fileSize(dest);
  if (existing > 0) {
    console.log(`  [skip] ${label} (already present, ${(existing / 1e6).toFixed(1)} MB)`);
    return { url, path: dest, sizeBytes: existing, skipped: true };
  }

  console.log(`  [get ] ${label}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${url}: ${response.status} ${response.statusText}`);
  }

  // Content-Length describes the COMPRESSED body. fetch() transparently
  // inflates gzip/br, so comparing it against the bytes we wrote is only valid
  // when the response was not encoded.
  const encoded = Boolean(response.headers.get('content-encoding'));
  const total = encoded ? 0 : (Number(response.headers.get('content-length')) || 0);
  await mkdir(dirname(dest), { recursive: true });
  const partPath = `${dest}.part`;

  let loaded = 0;
  let lastLog = 0;
  const progress = new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      const now = Date.now();
      if (total > 100e6 && now - lastLog > 5000) {
        lastLog = now;
        console.log(`         ${label}: ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
      }
      controller.enqueue(chunk);
    },
  });

  // Never leave a .part behind: verify-models.mjs treats one as a hard build
  // failure, but a stale file from a killed run would then block every later
  // build until removed by hand.
  try {
    await pipeline(Readable.fromWeb(response.body.pipeThrough(progress)), createWriteStream(partPath));
    if (total > 0 && loaded !== total) {
      throw new Error(`Truncated download for ${url}: got ${loaded} of ${total} bytes`);
    }
  } catch (err) {
    await rm(partPath, { force: true });
    throw err;
  }
  await rename(partPath, dest);
  console.log(`  [done] ${label} (${(loaded / 1e6).toFixed(1)} MB)`);
  return { url, path: dest, sizeBytes: loaded, skipped: false };
}

const entries = [];

console.log(`Fetching NER models (dtype=${DTYPE}) into ${MODELS_DIR}\\ner`);
for (const repo of NER_REPOS) {
  for (const file of NER_FILES) {
    const dest = join(MODELS_DIR, 'ner', ...repo.split('/'), ...file.split('/'));
    entries.push(await download(hfUrl(repo, file), dest, `${repo}/${file}`));
  }
}

console.log('Fetching OCR models into models\\ocr');
const detDest = join(MODELS_DIR, 'ocr', 'PP-OCRv5_mobile_det_onnx.tar');
entries.push(await download(OCR_DET_URL, detDest, 'PP-OCRv5_mobile_det_onnx.tar'));

const recDest = join(MODELS_DIR, 'ocr', 'latin_PP-OCRv5_mobile_rec.tar');
if ((await fileSize(recDest)) <= 0) {
  await mkdir(dirname(recDest), { recursive: true });
  await copyFile(OCR_REC_LOCAL, recDest);
  console.log('  [copy] latin_PP-OCRv5_mobile_rec.tar (from public/ocr-models)');
}
entries.push({
  url: 'public/ocr-models/latin_PP-OCRv5_mobile_rec.tar (vendored in repo)',
  path: recDest,
  sizeBytes: await fileSize(recDest),
  skipped: false,
});

console.log('Hashing files for the provenance manifest…');
const manifest = {
  generatedAt: new Date().toISOString(),
  dtype: DTYPE,
  files: [],
};
for (const entry of entries) {
  manifest.files.push({
    path: entry.path.slice(MODELS_DIR.length + 1).replaceAll('\\', '/'),
    url: entry.url,
    sizeBytes: entry.sizeBytes,
    sha256: await sha256File(entry.path),
  });
}
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${MANIFEST_PATH}`);
console.log('All models ready.');
