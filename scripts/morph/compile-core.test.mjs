import {
  parseTabFile,
  parsePeselCsv,
  freqBucket,
  collectLexemes,
  compileMorphData,
  AGREEMENT_THRESHOLD,
} from './compile-core.mjs';
import { loadMorphData } from '../../src/verifier/morph/load.js';

// Synthetic fixtures — hand-written shapes, no external dataset content.
// The real .tab/.csv column semantics get pinned against the downloaded
// files at anchor time (design §1.1); these tests prove the LOGIC.

const TAB = [
  '# comment line',
  'Anna\tAnna\tsubst:sg:nom:f\timię\t',
  'Anny\tAnna\tsubst:sg:gen:f\timię\t',
  'Annie\tAnna\tsubst:sg:dat.loc:f\timię\t',
  'Annę\tAnna\tsubst:sg:acc:f\timię\t',
  'Anną\tAnna\tsubst:sg:inst:f\timię\t',
  'Anno\tAnna\tsubst:sg:voc:f\timię\t',
  'Anny\tAnna\tsubst:pl:nom:f\timię\t', // plural — must be ignored
  // rule-agreeing surname (adjectival) — must stay OUT of the artifact
  'Żurawski\tŻurawski\tadj:sg:nom.voc:m1\tnazwisko\t',
  'Żurawskiego\tŻurawski\tadj:sg:gen.acc:m1\tnazwisko\t',
  'Żurawskiemu\tŻurawski\tadj:sg:dat:m1\tnazwisko\t',
  'Żurawskim\tŻurawski\tadj:sg:inst.loc:m1\tnazwisko\t',
  // variant surname (ó:o alternation) — must land in exceptions
  'Kozioł\tKozioł\tsubst:sg:nom:m1\tnazwisko\t',
  'Kozioła\tKozioł\tsubst:sg:gen.acc:m1\tnazwisko\t',
  'Kozła\tKozioł\tsubst:sg:gen.acc:m1\tnazwisko\t',
  'Koziołowi\tKozioł\tsubst:sg:dat:m1\tnazwisko\t',
  // rule-divergent adjectival -ny (degradation fixture): dictionary insists
  // on a different genitive than the rule predicts
  'Chmielny\tChmielny\tadj:sg:nom.voc:m1\tnazwisko\t',
  'Chmielnygo\tChmielny\tadj:sg:gen.acc:m1\tnazwisko\t',
  // procedural role lemma (no name classification)
  'powód\tpowód\tsubst:sg:nom:m1\t\t',
  'powoda\tpowód\tsubst:sg:gen.acc:m1\t\t',
  'powodowi\tpowód\tsubst:sg:dat:m1\t\t',
  'powodem\tpowód\tsubst:sg:inst:m1\t\t',
  'powodzie\tpowód\tsubst:sg:loc.voc:m1\t\t',
].join('\n');

const IMIONA_CSV = [
  'IMIĘ_PIERWSZE;PŁEĆ;LICZBA_WYSTĄPIEŃ',
  'ANNA;KOBIETA;1000000',
  'KONRAD;MĘŻCZYZNA;50000',
].join('\n');

const NAZWISKA_CSV = [
  'Nazwisko;Liczba wystąpień',
  'KOWALSKI;135000',
  'KOZIOŁ;30000',
].join('\n');

const ZRODLA = { sgjp: { filename: 'fixture.tab', sha256: 'deadbeef', license: 'BSD-2-Clause' } };

function compile() {
  return compileMorphData({ sgjpTab: TAB, imionaCsv: IMIONA_CSV, nazwiskaCsv: NAZWISKA_CSV, zrodla: ZRODLA });
}

describe('parseTabFile / parsePeselCsv / freqBucket', () => {
  it('parses TSV rows, skips comments, fails on malformed rows and empty files', () => {
    expect(parseTabFile(TAB).length).toBeGreaterThan(10);
    expect(() => parseTabFile('tylko-jedna-kolumna')).toThrow(/zły wiersz/);
    expect(() => parseTabFile('# nic\n')).toThrow(/pusty/);
  });

  it('parses PESEL CSVs with either delimiter and hard-fails on unknown headers', () => {
    const rows = parsePeselCsv(IMIONA_CSV, 'imiona');
    expect(rows).toEqual([
      { name: 'ANNA', gender: 'f', count: 1000000 },
      { name: 'KONRAD', gender: 'm', count: 50000 },
    ]);
    expect(parsePeselCsv('nazwisko,count\nKos,10', 'nazwiska')).toEqual([{ name: 'Kos', count: 10 }]);
    expect(() => parsePeselCsv('foo;bar\nx;1', 'imiona')).toThrow(/nie znajduję kolumny/);
  });

  it('buckets frequency on log10, clamped to 1..6', () => {
    expect(freqBucket(5)).toBe(1);
    expect(freqBucket(500)).toBe(3);
    expect(freqBucket(1_000_000)).toBe(6);
    expect(freqBucket(1e12)).toBe(6);
  });

  it('collects singular lexeme forms with fused case tags split', () => {
    const lexemes = collectLexemes(parseTabFile(TAB), 'nazwisko');
    const zurawski = lexemes.get('Żurawski::m');
    expect([...zurawski.formy.get('M')]).toEqual(['Żurawski']);
    expect([...zurawski.formy.get('W')]).toEqual(['Żurawski']);
    expect([...zurawski.formy.get('B')]).toEqual(['Żurawskiego']);
  });
});

describe('compileMorphData — sections and the subtractive dictionary (§1.4)', () => {
  const { artifact, json, report, agreementTable } = compile();

  it('imiona: Z1∩Z2 gets a paradigm, Z2-only becomes an entity without one', () => {
    expect(artifact.imiona.anna).toMatchObject({ rodzaj: 'f', frek: 6 });
    expect(artifact.imiona.anna.paradygmat).toMatchObject({ M: 'Anna', D: 'Anny', C: 'Annie', W: 'Anno' });
    expect(artifact.imiona.konrad).toEqual({ frek: 5, paradygmat: null, rodzaj: 'm' });
  });

  it('nazwiska: rule-agreeing lexeme stays OUT, variant lexeme lands IN with warianty', () => {
    expect(artifact.nazwiska['Żurawski']).toBeUndefined();
    expect(artifact.nazwiska['Kozioł']).toBeDefined();
    expect(artifact.nazwiska['Kozioł'].warianty).toBe(true);
    expect(artifact.nazwiska['Kozioł'].formy.D).toEqual(['Kozioła', 'Kozła']);
  });

  it('measures agreement per class and degrades classes under the threshold', () => {
    expect(agreementTable['adjectival-ski-m']).toMatchObject({ total: 1, zgodne: 1, zdegradowana: false });
    expect(agreementTable['adjectival-ny-m']).toMatchObject({ total: 1, zgodne: 0, zdegradowana: true });
    expect(AGREEMENT_THRESHOLD).toBe(0.98);
    expect(artifact.meta.klasyStatus['adjectival-ny-m']).toBe('dictionary-only');
    expect(artifact.nazwiska['Chmielny']).toBeDefined();
  });

  it('role: paradigms compiled from the tab for ROLE_LEMMAS members', () => {
    expect(artifact.role['powód']).toMatchObject({
      M: 'powód', D: 'powoda', C: 'powodowi', N: 'powodem', Ms: 'powodzie',
    });
  });

  it('frekwencja: top-N surname buckets', () => {
    expect(artifact.frekwencja.nazwiska).toEqual({ Kowalski: 6, 'Kozioł': 5 });
  });

  it('is deterministic: double compilation is byte-identical (G-W1-4)', () => {
    const second = compile();
    expect(second.json).toBe(json);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps in content
  });

  it('report carries the gate review material (§1.4.4)', () => {
    expect(report).toContain('Zgodność reguł per klasa');
    expect(report).toContain('adjectival-ny-m');
    expect(report).toContain('ZDEGRADOWANA');
    expect(report).toContain('decyzja bytowania');
  });
});

describe('loadMorphData consumes the compiled artifact (§1.6)', () => {
  const { artifact } = compile();

  it('builds the maps and the reverse index', () => {
    const morph = loadMorphData(artifact);
    expect(morph.imiona.get('anna').rodzaj).toBe('f');
    expect(morph.role.get('powód').C).toBe('powodowi');
    expect(morph.formaDoLematu.get('kozła')).toContainEqual(
      expect.objectContaining({ lemat: 'Kozioł', sekcja: 'nazwiska' }),
    );
    expect(morph.formaDoLematu.get('annie')).toContainEqual(
      expect.objectContaining({ lemat: 'anna', sekcja: 'imiona' }),
    );
    expect(morph.meta.wersjaFormatu).toBe('morph-pl/1');
  });

  it('fails closed on version or shape drift', () => {
    expect(() => loadMorphData({ ...artifact, meta: { wersjaFormatu: 'morph-pl/2' } })).toThrow(/wersja formatu/);
    expect(() => loadMorphData({ meta: { wersjaFormatu: 'morph-pl/1' } })).toThrow(/sekcja/);
    expect(() => loadMorphData(null)).toThrow();
  });
});
