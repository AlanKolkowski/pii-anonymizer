// Guard tests for the eval measurement path (EVAL-RECALL-AUDIT.md, part A).
//
// Ground-truth convention: offsets in *.expected.json (and
// *.expected-segments.json) are UTF-16 code-unit indices into the document
// text with LF line endings — the repo-canonical content. A Windows checkout
// with core.autocrlf=true materializes CRLF on disk, which shifts every
// offset by +1 per preceding newline; reading the raw working-tree bytes is
// exactly the bug that once zeroed every eval score. These tests break
// loudly if the convention is violated again, from any direction:
//   - annotations drift from the text (regeneration bug, manual edit),
//   - someone re-encodes offsets in code points instead of UTF-16 units,
//   - the CRLF-vs-LF mismatch detector itself stops detecting.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEol, validateExpectedOffsets } from './eval-text.js';
import { allEntityTypes } from '../pipeline/configs/entity-sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, '../../test-data');

// Every corpus directory holding ground truth. `adversarial` joins the guard
// automatically once it exists.
const CORPUS_DIRS = ['synthetic', 'adversarial']
  .map((d) => join(TEST_DATA_DIR, d))
  .filter((d) => existsSync(d));

function loadCorpus() {
  const docs = [];
  for (const dir of CORPUS_DIRS) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.expected.json')).sort();
    for (const f of files) {
      const name = f.replace(/\.expected\.json$/, '');
      const txtPath = join(dir, `${name}.txt`);
      const segPath = join(dir, `${name}.expected-segments.json`);
      docs.push({
        corpus: basename(dir),
        name,
        expected: JSON.parse(readFileSync(join(dir, f), 'utf-8')),
        raw: existsSync(txtPath) ? readFileSync(txtPath, 'utf-8') : null,
        expectedSegments: existsSync(segPath)
          ? JSON.parse(readFileSync(segPath, 'utf-8'))
          : null,
      });
    }
  }
  return docs;
}

function toCrlf(lfText) {
  return lfText.replace(/\n/g, '\r\n');
}

const docs = loadCorpus();
const KNOWN_TYPES = new Set(allEntityTypes());

describe('ground truth: corpus discovery', () => {
  it('finds at least the synthetic corpus', () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  it('every .expected.json has a matching .txt', () => {
    const missing = docs.filter((d) => d.raw === null).map((d) => `${d.corpus}/${d.name}`);
    expect(missing).toEqual([]);
  });
});

describe('ground truth: offsets are LF + UTF-16 code units', () => {
  for (const doc of docs.filter((d) => d.raw !== null)) {
    const lf = normalizeEol(doc.raw);

    it(`${doc.corpus}/${doc.name}: every expected entity matches the LF text at its offsets`, () => {
      const mismatches = validateExpectedOffsets(doc.expected, lf).map((m) => ({
        index: m.index,
        span: `[${m.entity.start}:${m.entity.end}]`,
        expected: m.entity.text,
        actual: m.actual,
      }));
      expect(mismatches).toEqual([]);
    });

    it(`${doc.corpus}/${doc.name}: entity hygiene (bounds, non-empty, known types, no overlap)`, () => {
      for (const e of doc.expected) {
        expect(e.start).toBeGreaterThanOrEqual(0);
        expect(e.end).toBeGreaterThan(e.start);
        expect(e.end).toBeLessThanOrEqual(lf.length);
        expect(e.text.length).toBeGreaterThan(0);
        expect(KNOWN_TYPES.has(e.entity_group), `unknown type ${e.entity_group}`).toBe(true);
      }
      const sorted = [...doc.expected].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        expect(
          sorted[i].start >= sorted[i - 1].end,
          `overlap: [${sorted[i - 1].start}:${sorted[i - 1].end}] and [${sorted[i].start}:${sorted[i].end}]`,
        ).toBe(true);
      }
    });

    if (doc.expectedSegments) {
      it(`${doc.corpus}/${doc.name}: expected segments match the LF text at their offsets`, () => {
        const mismatches = validateExpectedOffsets(doc.expectedSegments, lf).map((m) => ({
          index: m.index,
          span: `[${m.entity.start}:${m.entity.end}]`,
        }));
        expect(mismatches).toEqual([]);
      });
    }
  }
});

describe('ground truth: canaries', () => {
  it('CRLF canary: the validator detects offsets applied to CRLF-encoded text', () => {
    // Docs where at least one entity sits after the first newline shift
    // under CRLF; the validator MUST report them. If this test fails, the
    // validator has silently stopped guarding against the exact bug that
    // once zeroed every eval score.
    const exercised = docs.filter((d) => {
      if (d.raw === null || d.expected.length === 0) return false;
      const lf = normalizeEol(d.raw);
      const firstNewline = lf.indexOf('\n');
      if (firstNewline === -1) return false;
      return d.expected.some((e) => e.start > firstNewline);
    });
    expect(exercised.length).toBeGreaterThan(0);
    for (const doc of exercised) {
      const crlf = toCrlf(normalizeEol(doc.raw));
      const mismatches = validateExpectedOffsets(doc.expected, crlf);
      expect(
        mismatches.length,
        `${doc.corpus}/${doc.name}: CRLF re-encoding must invalidate offsets`,
      ).toBeGreaterThan(0);
    }
  });

  it('astral canary: offsets count UTF-16 units, not code points (pismo_07_emoji_astral)', () => {
    const doc = docs.find((d) => d.name === 'pismo_07_emoji_astral');
    expect(doc, 'pismo_07_emoji_astral must exist in the corpus').toBeTruthy();
    const lf = normalizeEol(doc.raw);
    expect(/[\u{10000}-\u{10FFFF}]/u.test(lf), 'document must contain astral characters').toBe(true);

    // UTF-16 interpretation is valid…
    expect(validateExpectedOffsets(doc.expected, lf)).toEqual([]);

    // …and the code-point interpretation is NOT, for at least one entity
    // placed after the astral characters. If both interpretations ever agree,
    // this canary lost its astral chars and cannot pin the convention.
    const codePoints = [...lf];
    const codePointDiffers = doc.expected.some(
      (e) => codePoints.slice(e.start, e.end).join('') !== e.text,
    );
    expect(codePointDiffers).toBe(true);
  });
});
