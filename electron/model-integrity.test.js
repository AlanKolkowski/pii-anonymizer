import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyModelIntegrity } from './model-integrity.mjs';

// This is the runtime gate that stands between a tampered model file and a
// silent fail-open anonymizer (SECURITY.md §12a, THREAT-MODEL.md §4 S1). It
// must refuse to start on every kind of corruption/tampering, never just log
// a warning and continue.
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

describe('verifyModelIntegrity', () => {
  let dir;
  let modelsRoot;
  let anchorPath;
  const GOOD_A = Buffer.from('model file A contents');
  const GOOD_B = Buffer.from('model file B contents, a bit longer');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'model-integrity-test-'));
    modelsRoot = join(dir, 'models');
    mkdirSync(join(modelsRoot, 'ner'), { recursive: true });
    writeFileSync(join(modelsRoot, 'ner', 'a.onnx'), GOOD_A);
    writeFileSync(join(modelsRoot, 'ner', 'b.onnx'), GOOD_B);

    anchorPath = join(dir, 'model-manifest.json');
    writeFileSync(anchorPath, JSON.stringify({
      dtype: 'q8',
      files: [
        { path: 'ner/a.onnx', sizeBytes: GOOD_A.length, sha256: sha256(GOOD_A) },
        { path: 'ner/b.onnx', sizeBytes: GOOD_B.length, sha256: sha256(GOOD_B) },
      ],
    }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when every file matches size and SHA-256', async () => {
    const result = await verifyModelIntegrity({ anchorPath, modelsRoot });
    expect(result).toEqual({ ok: true });
  });

  it('fails closed when a model file is byte-tampered (same size, different content)', async () => {
    const tampered = Buffer.from(GOOD_A); // same length as GOOD_A
    tampered[0] ^= 0xff;
    writeFileSync(join(modelsRoot, 'ner', 'a.onnx'), tampered);

    const result = await verifyModelIntegrity({ anchorPath, modelsRoot });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/zła suma SHA-256 ner\/a\.onnx/);
  });

  it('fails closed when a model file shrinks (e.g. truncated download or swap)', async () => {
    writeFileSync(join(modelsRoot, 'ner', 'a.onnx'), GOOD_A.subarray(0, 5));

    const result = await verifyModelIntegrity({ anchorPath, modelsRoot });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/zły rozmiar ner\/a\.onnx/);
  });

  it('fails closed when a model file is missing entirely', async () => {
    rmSync(join(modelsRoot, 'ner', 'b.onnx'));

    const result = await verifyModelIntegrity({ anchorPath, modelsRoot });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/brak pliku: ner\/b\.onnx/);
  });

  it('fails closed when the anchor itself is missing', async () => {
    const result = await verifyModelIntegrity({ anchorPath: join(dir, 'does-not-exist.json'), modelsRoot });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/Brak kotwicy integralności/);
  });

  it('fails closed when the anchor is unparseable JSON', async () => {
    writeFileSync(anchorPath, '{ not valid json');
    const result = await verifyModelIntegrity({ anchorPath, modelsRoot });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/Nieczytelna kotwica integralności/);
  });

  it('fails closed when the anchor has no file entries', async () => {
    writeFileSync(anchorPath, JSON.stringify({ dtype: 'q8', files: [] }));
    const result = await verifyModelIntegrity({ anchorPath, modelsRoot });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/nie zawiera wpisów/);
  });

  it('reports every mismatch, not just the first', async () => {
    rmSync(join(modelsRoot, 'ner', 'b.onnx'));
    writeFileSync(join(modelsRoot, 'ner', 'a.onnx'), GOOD_A.subarray(0, 5));

    const result = await verifyModelIntegrity({ anchorPath, modelsRoot });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(2);
  });
});
