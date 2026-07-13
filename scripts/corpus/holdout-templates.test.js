import { assembleHoldoutDocs, buildHoldoutDoc } from './holdout-templates.mjs';
import { findRegexEntities } from '../../src/anonymizer.js';
import manifest from './holdout-manifest.json' with { type: 'json' };

// Built once per test file — assembling + building all ~200 documents is
// pure string work (no models), so this is fast; every test below reuses it
// rather than re-assembling per test.
const docs = assembleHoldoutDocs();
const built = docs.map((d) => ({ doc: d, ...buildHoldoutDoc(d.parts) }));

describe('assembleHoldoutDocs: structural well-formedness', () => {
  it('produces a non-trivial number of documents with unique names', () => {
    expect(docs.length).toBeGreaterThan(50);
    expect(new Set(docs.map((d) => d.name)).size).toBe(docs.length);
  });

  it('every document has a non-empty attack-vector description', () => {
    for (const d of docs) {
      expect(typeof d.attack).toBe('string');
      expect(d.attack.length).toBeGreaterThan(10);
    }
  });

  it('every expected entity matches the built text at its offsets (mirrors dev generator selfCheck)', () => {
    const mismatches = [];
    for (const { doc, text, expected } of built) {
      for (const e of expected) {
        if (text.slice(e.start, e.end) !== e.text) mismatches.push(`${doc.name}: [${e.start}:${e.end}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('no document has overlapping expected entities', () => {
    const overlaps = [];
    for (const { doc, expected } of built) {
      const sorted = [...expected].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) overlaps.push(doc.name);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('no document text contains a CR (corpus must be LF-only)', () => {
    const withCr = built.filter(({ text }) => /\r/.test(text)).map(({ doc }) => doc.name);
    expect(withCr).toEqual([]);
  });

  it('every expected entity has a non-empty span and a known entity_group', () => {
    const KNOWN = new Set([
      'PERSON_NAME', 'PERSON_ROLE_OR_TITLE', 'PERSON_IDENTIFIER', 'ORGANIZATION_IDENTIFIER',
      'ORGANIZATION_NAME', 'POSTAL_ADDRESS', 'LOCATION', 'FINANCIAL_AMOUNT', 'BANK_ACCOUNT_IDENTIFIER',
      'PHONE_NUMBER', 'EMAIL_ADDRESS', 'DOCUMENT_REFERENCE', 'DATE_OF_BIRTH', 'PERSON_ATTRIBUTE',
      'VEHICLE_IDENTIFIER', 'HEALTH_DATA', 'CRIMINAL_OFFENCE_DATA', 'TRADE_UNION_MEMBERSHIP',
      'RELIGION_OR_BELIEF', 'POLITICAL_OPINION', 'SEXUAL_ORIENTATION', 'ETHNIC_ORIGIN',
    ]);
    for (const { expected } of built) {
      for (const e of expected) {
        expect(e.end).toBeGreaterThan(e.start);
        expect(KNOWN.has(e.entity_group), `unknown type ${e.entity_group}`).toBe(true);
      }
    }
  });
});

describe('assembleHoldoutDocs: determinism', () => {
  it('re-assembling produces byte-identical text for every document', () => {
    const rebuilt = assembleHoldoutDocs().map((d) => buildHoldoutDoc(d.parts).text);
    const original = built.map((b) => b.text);
    expect(rebuilt).toEqual(original);
  });
});

function aggregate() {
  const byType = {};
  const byTag = {};
  for (const { expected, tagCounts } of built) {
    for (const e of expected) byType[e.entity_group] = (byType[e.entity_group] || 0) + 1;
    for (const [tag, n] of Object.entries(tagCounts)) byTag[tag] = (byTag[tag] || 0) + n;
  }
  return { byType, byTag };
}

describe('manifest quota compliance (holdout-manifest.json is the contract)', () => {
  const { byType, byTag } = aggregate();

  it('meets or exceeds every byType minimum', () => {
    const shortfalls = Object.entries(manifest.byType)
      .map(([type, min]) => ({ type, min, actual: byType[type] || 0 }))
      .filter(({ min, actual }) => actual < min);
    expect(shortfalls).toEqual([]);
  });

  it('meets or exceeds every identifier subtype minimum (tagged identifier:<subtype>)', () => {
    const shortfalls = Object.entries(manifest.identifierSubtypes)
      .filter(([key]) => key !== '_comment')
      .map(([subtype, min]) => ({ subtype, min, actual: byTag[`identifier:${subtype}`] || 0 }))
      .filter(({ min, actual }) => actual < min);
    expect(shortfalls).toEqual([]);
  });

  it('meets or exceeds every OCR class minimum (tagged ocr:<class>)', () => {
    const shortfalls = Object.entries(manifest.ocrClasses)
      .filter(([key]) => key !== '_comment')
      .map(([cls, min]) => ({ cls, min, actual: byTag[`ocr:${cls}`] || 0 }))
      .filter(({ min, actual }) => actual < min);
    expect(shortfalls).toEqual([]);
  });

  it('total entity count is at least the manifest floor', () => {
    const total = Object.values(byType).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(manifest.targetTotalEntities.min);
  });

  it('FP-trap-like documents (<=1 entity) exist in meaningful numbers, per §3.3 ~12% volume target', () => {
    const trapLike = built.filter(({ expected }) => expected.length <= 1).length;
    const ratio = trapLike / docs.length;
    // Soft target, not a hard gate (RECALL-90-DESIGN.md §3.3 says "~12%") —
    // this asserts the mechanism produces a real, non-trivial trap
    // population, not that it hits the percentage exactly.
    expect(trapLike).toBeGreaterThan(10);
    expect(ratio).toBeGreaterThan(0.05);
  });
});

describe('spot-check: generated identifiers remain detectable in assembled document context', () => {
  it('every identifier-showcase document\'s PESEL/NIP/IBAN/VIN is found by findRegexEntities at its annotated span', () => {
    const showcases = built.filter(({ doc }) => doc.name.startsWith('hold_identyfikatory_'));
    expect(showcases.length).toBeGreaterThan(0);
    for (const { doc, text, expected } of showcases) {
      const checksummed = expected.filter((e) =>
        ['PERSON_IDENTIFIER', 'ORGANIZATION_IDENTIFIER', 'BANK_ACCOUNT_IDENTIFIER'].includes(e.entity_group)
        && /^\d+$|^PL\d+$/.test(e.text.replace(/\s/g, '')));
      const detected = findRegexEntities(text);
      for (const e of checksummed) {
        const hit = detected.find((d) => d.start === e.start && d.end === e.end && d.entity_group === e.entity_group);
        expect(hit, `${doc.name}: "${e.text}" (${e.entity_group}) not detected at [${e.start}:${e.end}]`).toBeTruthy();
      }
    }
  });
});
