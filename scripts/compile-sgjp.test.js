// Tests for scripts/compile-sgjp.mjs (FLEKSJA-IMPL-PLAN.md SS1.4/SS2.2,
// FL-1a: "kompilator + testy na mini-fixture"). Written test-first: this
// file fails to even import until compile-sgjp.mjs exists (RED), then goes
// green against the implementation.
//
// Three layers, cheapest-to-most-integrated:
//   1. unit tests on the small pure parsing/tagging helpers,
//   2. compileFromLines on small INLINE row sets (fail-closed edge cases
//      that would be awkward to encode in the committed fixture file),
//   3. end-to-end: compileFile() on the COMMITTED scripts/fixtures/
//      mini-sgjp.tab -> loadMorphData() (real load.js) -> analyzePersonName/
//      generateForm (real analyze.js/generate.js) correctly inflect surnames
//      and given names FROM the fixture. This is the chain the task exists
//      to prove.
//
// Laptop-safe: no network, no models, everything in-process or on tmpdir.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  SgjpFormatError,
  parseTabLine,
  splitTag,
  validateShape,
  compileFromLines,
  compileFile,
  SGJP_LICENSE_NOTICE,
} from './compile-sgjp.mjs';
import { loadMorphData, MORPH_FORMAT_VERSION } from '../src/verifier/morph/load.js';
import { analyzePersonName } from '../src/verifier/morph/analyze.js';
import { generateForm, fullParadigm } from '../src/verifier/morph/generate.js';
import { MINI_LEXICON } from '../src/verifier/morph/fixtures/mini-lexicon.js';

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'mini-sgjp.tab');

// Small helper: async-iterable over an array of lines, mirroring what
// readLines(path) yields — lets the compileFromLines tests below stay pure
// (no disk I/O) for the fail-closed/edge-case matrix.
async function* linesOf(text) {
  for (const line of text.split('\n')) yield line;
}

describe('parseTabLine — column shape (forma, lemat, tag, klasyfikacja, [kwalifikatory])', () => {
  it('parses a minimal 4-column line', () => {
    expect(parseTabLine('a\ta\tinterj\tpospolita')).toEqual({
      ok: true, forma: 'a', lemat: 'a', lemmaHomonym: null, tag: 'interj', klasyfikacja: 'pospolita', kwalifikatory: [],
    });
  });

  it('parses a 5-column line with pipe-separated qualifiers', () => {
    const parsed = parseTabLine('czerwony\tczerwony\tadj:sg:nom:m3:pos\tpospolita\tkwal1|kwal2');
    expect(parsed.ok).toBe(true);
    expect(parsed.kwalifikatory).toEqual(['kwal1', 'kwal2']);
  });

  it('splits a homonym-numbered lemma ("lemma:2")', () => {
    const parsed = parseTabLine('kot\tkot:2\tsubst:sg:nom:m2\tpospolita');
    expect(parsed.lemat).toBe('kot');
    expect(parsed.lemmaHomonym).toBe(2);
  });

  it('tolerates a trailing \\r (CRLF checkout, core.autocrlf)', () => {
    expect(parseTabLine('a\ta\tinterj\tpospolita\r').ok).toBe(true);
  });

  it('returns null for blank lines and #-comment lines (never fed to the compiler)', () => {
    expect(parseTabLine('')).toBeNull();
    expect(parseTabLine('   ')).toBeNull();
    expect(parseTabLine('# a comment')).toBeNull();
  });

  it('flags too few columns as a problem, never throws, never guesses', () => {
    const parsed = parseTabLine('only\tthree\tcols');
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/kolumn/);
  });

  it('flags an empty required column', () => {
    expect(parseTabLine('forma\t\ttag\tklasyfikacja').ok).toBe(false);
  });
});

describe('splitTag — position-independent case/gender/number token scan', () => {
  it('maps the seven SGJP case abbreviations onto the project M/D/C/B/N/Ms/W alphabet', () => {
    expect(splitTag('subst:sg:nom:m1').cases).toEqual(['M']);
    expect(splitTag('subst:sg:gen:m1').cases).toEqual(['D']);
    expect(splitTag('subst:sg:dat:m1').cases).toEqual(['C']);
    expect(splitTag('subst:sg:acc:m1').cases).toEqual(['B']);
    expect(splitTag('subst:sg:inst:m1').cases).toEqual(['N']);
    expect(splitTag('subst:sg:loc:m1').cases).toEqual(['Ms']);
    expect(splitTag('subst:sg:voc:m1').cases).toEqual(['W']);
  });

  it('maps m1/m2/m3 to "m" and f to "f"', () => {
    expect(splitTag('subst:sg:nom:m1').genders).toEqual(['m']);
    expect(splitTag('subst:sg:nom:m2').genders).toEqual(['m']);
    expect(splitTag('subst:sg:nom:m3').genders).toEqual(['m']);
    expect(splitTag('subst:sg:nom:f').genders).toEqual(['f']);
  });

  it('splits dot-combined syncretic case segments (documented Morfeusz tagset shorthand, e.g. "nom.acc")', () => {
    expect(splitTag('subst:sg:nom.acc:m3').cases.sort()).toEqual(['B', 'M']);
  });

  it('extracts number tokens (sg/pl) unmapped, used to restrict role paradigms to singular', () => {
    expect(splitTag('subst:sg:nom:m1').numbers).toEqual(['sg']);
    expect(splitTag('subst:pl:nom:m1').numbers).toEqual(['pl']);
  });

  it('ignores unrecognized segments (degree markers, flexeme class) without error', () => {
    const t = splitTag('adj:sg:nom:m1:pos');
    expect(t.cases).toEqual(['M']);
    expect(t.genders).toEqual(['m']);
  });
});

describe('validateShape — fail-closed gate on the file BEFORE any compilation', () => {
  it('accepts a sample that looks like real SGJP tab lines', () => {
    const sample = ['a\ta\tinterj\tpospolita', 'Jan\tJan\tsubst:sg:nom:m1\timię'];
    expect(validateShape(sample)).toMatchObject({ ok: true });
  });

  it('rejects a sample with too few columns (e.g. comma-separated file fed in by mistake)', () => {
    const sample = ['a,a,interj,pospolita', 'Jan,Jan,subst:sg:nom:m1,imię'];
    const result = validateShape(sample);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('rejects a sample whose tag column is not colon-segmented (wrong file format entirely)', () => {
    const sample = ['a\ta\tNOT A TAG AT ALL\tpospolita', 'b\tb\tstill not a tag\tpospolita'];
    expect(validateShape(sample).ok).toBe(false);
  });

  it('rejects an empty sample (comments/blank lines only)', () => {
    expect(validateShape(['', '# just a comment']).ok).toBe(false);
  });
});

describe('compileFromLines — subtractive dictionary (FLEKSJA-IMPL-PLAN.md SS1.4.2)', () => {
  it('a fully rule-predictable surname is SUBTRACTED (zero footprint in the artifact)', async () => {
    // "Baran" (noun-masculine, closed locative table) — paradigms.test.js
    // already proves the rule engine gets every case right; feed exactly
    // that agreeing paradigm in and expect it excluded.
    const rows = [
      'Baran\tBaran\tsubst:sg:nom:m1\tnazwisko',
      'Barana\tBaran\tsubst:sg:gen:m1\tnazwisko',
      'Baranowi\tBaran\tsubst:sg:dat:m1\tnazwisko',
      'Barana\tBaran\tsubst:sg:acc:m1\tnazwisko',
      'Baranem\tBaran\tsubst:sg:inst:m1\tnazwisko',
      'Baranie\tBaran\tsubst:sg:loc:m1\tnazwisko',
      'Baranie\tBaran\tsubst:sg:voc:m1\tnazwisko',
    ].join('\n');
    const { artifact, stats } = await compileFromLines(linesOf(rows));
    expect(artifact.nazwiska.Baran).toBeUndefined();
    expect(stats.counts.nazwiska).toBe(0);
    expect(stats.ruleAgreement['noun-masculine']).toMatchObject({ total: 1, subtracted: 1, exceptions: 0 });
  });

  it('a diverging surname is included WHOLE (every attested case, not just the diverging ones)', async () => {
    // Deliberately tiny: only M and D attested. Rule predicts D="X owi"-style
    // agreement is irrelevant here — what matters is the compiler stores
    // BOTH attested cases once ANY case diverges, so a later lookup on the
    // nominative surface form still resolves via the dictionary (never
    // silently reroutes to the rule engine mid-lexeme).
    const rows = [
      'Kozioł\tKozioł\tsubst:sg:nom:m1\tnazwisko',
      'Kozła\tKozioł\tsubst:sg:gen:m1\tnazwisko',
      'Kozioła\tKozioł\tsubst:sg:gen:m1\tnazwisko',
    ].join('\n');
    const { artifact } = await compileFromLines(linesOf(rows));
    expect(artifact.nazwiska.Kozioł.formy.M).toBe('Kozioł');
    expect(artifact.nazwiska.Kozioł.formy.D.slice().sort()).toEqual(['Kozioła', 'Kozła']);
    expect(artifact.nazwiska.Kozioł.warianty).toBe(true);
  });

  it('a foreign-orthography surname (rule refuses by construction) is included via the SAME mechanism, no special-casing', async () => {
    const rows = [
      'Fischer\tFischer\tsubst:sg:nom:m1\tnazwisko',
      'Fischera\tFischer\tsubst:sg:gen:m1\tnazwisko',
    ].join('\n');
    const { artifact, stats } = await compileFromLines(linesOf(rows));
    expect(artifact.nazwiska.Fischer).toEqual({ formy: { M: 'Fischer', D: 'Fischera' }, warianty: false });
    expect(stats.ruleAgreement['flaga:obce']).toMatchObject({ total: 1, subtracted: 0, exceptions: 1 });
  });

  it('a given name with only ONE attested case compiles a sparse paradigm, never fabricating the rest', async () => {
    const rows = ['Marek\tMarek\tsubst:sg:nom:m1\timię'].join('\n');
    const { artifact } = await compileFromLines(linesOf(rows));
    expect(artifact.imiona.marek).toEqual({ rodzaj: 'm', paradygmat: { M: 'Marek' }, frek: 0 });
  });

  it('a lemma attested under two genders is reported "m/f", sourcing the paradigm from the more-attested gender', async () => {
    const rows = [
      'Maria\tMaria\tsubst:sg:nom:f\timię',
      'Marii\tMaria\tsubst:sg:gen:f\timię',
      'Maria\tMaria\tsubst:sg:nom:m1\timię',
    ].join('\n');
    const { artifact } = await compileFromLines(linesOf(rows));
    expect(artifact.imiona.maria.rodzaj).toBe('m/f');
    expect(artifact.imiona.maria.paradygmat).toEqual({ M: 'Maria', D: 'Marii' });
  });

  it('conflicting forms for the same (imię lemma, case) refuse to pick one silently', async () => {
    const rows = [
      'Ala\tAla\tsubst:sg:nom:f\timię',
      'Ali\tAla\tsubst:sg:gen:f\timię',
      'Alli\tAla\tsubst:sg:gen:f\timię', // bogus second genitive form — a genuine anomaly, not variantness support for imiona
    ].join('\n');
    await expect(compileFromLines(linesOf(rows))).rejects.toThrow(SgjpFormatError);
  });

  it('conflicting forms for the same (role lemma, case) refuse to pick one silently', async () => {
    const rows = [
      'powód\tpowód\tsubst:sg:nom:m1\tpospolita',
      'powoda\tpowód\tsubst:sg:gen:m1\tpospolita',
      'powodu\tpowód\tsubst:sg:gen:m1\tpospolita',
    ].join('\n');
    await expect(compileFromLines(linesOf(rows), { roleLemmas: ['powód'] })).rejects.toThrow(SgjpFormatError);
  });

  it('two genders of the SAME spelled surname merge cleanly when their attested forms agree', async () => {
    const rows = [
      'Kowal\tKowal\tsubst:sg:nom:m1\tnazwisko',
      'Kowal\tKowal\tsubst:sg:nom:f\tnazwisko',
    ].join('\n');
    // Both genders agree on M ("Kowal" unchanged) — must not throw.
    const { artifact } = await compileFromLines(linesOf(rows));
    // Rule-predictable for at least one gender reading -> may or may not
    // survive subtraction; the point of this test is ONLY that merging
    // identical cross-gender forms does not throw (see the next test for
    // the genuinely-conflicting case).
    expect(artifact).toBeTruthy();
  });

  it('two genders of the SAME spelled surname with genuinely DIFFERENT forms refuse (artifact has no gender axis on the lemma key)', async () => {
    const rows = [
      'Kowal\tKowal\tsubst:sg:gen:m1\tnazwisko', // pretend gen(m1) = "Kowal" (indeclinable reading)
      'Kowala\tKowal\tsubst:sg:gen:f\tnazwisko', // pretend gen(f) = "Kowala" (genuinely different)
    ].join('\n');
    await expect(compileFromLines(linesOf(rows))).rejects.toThrow(SgjpFormatError);
  });

  it('plural rows are ignored (v1 scope is singular only, per FLEKSJA-IMPL-PLAN.md SS1.4.1 "pełne paradygmaty lp")', async () => {
    const rows = [
      'powód\tpowód\tsubst:sg:nom:m1\tpospolita',
      'powodowie\tpowód\tsubst:pl:nom:m1\tpospolita',
    ].join('\n');
    const { artifact } = await compileFromLines(linesOf(rows), { roleLemmas: ['powód'] });
    expect(artifact.role.powód).toEqual({ M: 'powód' });
  });

  it('a "pospolita" row for a non-role lemma is skipped, not fabricated into any section', async () => {
    const rows = ['sąd\tsąd\tsubst:sg:nom:m3\tpospolita\tprawn.'].join('\n');
    const { artifact, stats } = await compileFromLines(linesOf(rows), { roleLemmas: ['powód'] });
    expect(artifact.imiona).toEqual({});
    expect(artifact.nazwiska).toEqual({});
    expect(artifact.role).toEqual({});
    expect(stats.classificationCounts.pospolita).toBe(1);
  });

  it('a proper-name row whose subclass is NEITHER imię NOR nazwisko (e.g. "geograficzna") is skipped, only tallied', async () => {
    // "geograficzna" is a confirmed real sibling label (Morfeusz2.pdf §7.1
    // example: `Gdańsk ... geograficzna`). A recognized label must also appear
    // or the compiler fail-closes; Tomasz (imię) provides it.
    const rows = [
      'Tomasz\tTomasz\tsubst:sg:nom:m1\timię',
      'Sopot\tSopot\tsubst:sg:nom:m3\tgeograficzna',
      'Sopotu\tSopot\tsubst:sg:gen:m3\tgeograficzna',
    ].join('\n');
    const { artifact, stats } = await compileFromLines(linesOf(rows));
    expect(artifact.imiona.tomasz).toBeDefined();
    expect(artifact.nazwiska).toEqual({});
    expect(artifact.role).toEqual({});
    expect(stats.classificationCounts.geograficzna).toBe(2);
  });

  it('fail-closed: zero rows at all refuses rather than emitting an empty artifact', async () => {
    await expect(compileFromLines(linesOf(''))).rejects.toThrow(SgjpFormatError);
  });

  it('fail-closed: no recognized classification label anywhere in the data refuses', async () => {
    const rows = ['a\ta\tsubst:sg:nom:m1\tjakas-inna-etykieta'].join('\n');
    await expect(compileFromLines(linesOf(rows))).rejects.toThrow(SgjpFormatError);
  });

  it('a malformed data row is a hard fail-closed error, never silently skipped into a partial artifact', async () => {
    const rows = [
      'powód\tpowód\tsubst:sg:nom:m1\tpospolita',
      'only\tthree\tcols',
    ].join('\n');
    await expect(compileFromLines(linesOf(rows))).rejects.toThrow(SgjpFormatError);
  });

  it('the artifact always carries the format version load.js expects and a BSD-2 license notice', async () => {
    const rows = ['powód\tpowód\tsubst:sg:nom:m1\tpospolita'].join('\n');
    const { artifact } = await compileFromLines(linesOf(rows), { roleLemmas: ['powód'] });
    expect(artifact.meta.wersjaFormatu).toBe(MORPH_FORMAT_VERSION);
    expect(artifact.meta.zrodla.sgjp.license).toBe('BSD-2-Clause');
    expect(artifact.meta.zrodla.sgjp.notice).toBe(SGJP_LICENSE_NOTICE);
  });

  it('output key ordering is sorted (determinism — double-compile byte identical, FLEKSJA-IMPL-PLAN.md SS1.4.3)', async () => {
    const rowsA = ['Zet\tZet\tsubst:sg:nom:m1\timię', 'Abc\tAbc\tsubst:sg:nom:m1\timię'].join('\n');
    const { artifact: a1 } = await compileFromLines(linesOf(rowsA));
    const { artifact: a2 } = await compileFromLines(linesOf(rowsA));
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(Object.keys(a1.imiona)).toEqual(['abc', 'zet']);
  });
});

describe('compileFile — end-to-end on the committed synthetic fixture', () => {
  let workDir;
  beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'sgjp-compile-test-')); });
  afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

  it('accepts the committed fixture and writes artifact + lock + report, sha256 self-consistent', async () => {
    const outputPath = join(workDir, 'morph-pl.json');
    const lockPath = join(workDir, 'morph-artifact.lock.json');
    const reportPath = join(workDir, 'COMPILE-REPORT.md');

    const result = await compileFile({ inputPath: FIXTURE_PATH, outputPath, lockPath, reportPath });

    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    expect(existsSync(reportPath)).toBe(true);

    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const writtenBytes = readFileSync(outputPath, 'utf8');
    const { createHash } = await import('node:crypto');
    expect(lock.sha256).toBe(createHash('sha256').update(writtenBytes).digest('hex'));
    expect(lock.sizeBytes).toBe(Buffer.byteLength(writtenBytes, 'utf8'));
    expect(lock.input.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.stats.counts).toEqual({ imiona: 4, nazwiska: 2, role: 2 });
    // The fixture's Sopot rows (geograficzna) are a non-name proper noun: skipped,
    // never added to imiona/nazwiska/role, only tallied among observed labels.
    expect(result.stats.classificationCounts.geograficzna).toBe(2);
  });

  it('a gzip-compressed copy of the SAME fixture compiles to an artifact identical to the plain-text run', async () => {
    const gzPath = join(workDir, 'mini-sgjp.tab.gz');
    writeFileSync(gzPath, gzipSync(readFileSync(FIXTURE_PATH)));

    const plainOut = join(workDir, 'plain.json');
    const gzOut = join(workDir, 'gz.json');
    await compileFile({ inputPath: FIXTURE_PATH, outputPath: plainOut, lockPath: join(workDir, 'plain.lock.json'), reportPath: join(workDir, 'plain-report.md') });
    await compileFile({ inputPath: gzPath, outputPath: gzOut, lockPath: join(workDir, 'gz.lock.json'), reportPath: join(workDir, 'gz-report.md') });

    // Both artifacts stamp sourceLabel from the input filename, so compare
    // everything EXCEPT meta.zrodla.sgjp.input (expected to legitimately differ).
    const plain = JSON.parse(readFileSync(plainOut, 'utf8'));
    const gz = JSON.parse(readFileSync(gzOut, 'utf8'));
    delete plain.meta.zrodla.sgjp.input;
    delete gz.meta.zrodla.sgjp.input;
    expect(gz).toEqual(plain);
  });

  it('fail-closed on a malformed input file: throws BEFORE writing any output file', async () => {
    const badPath = join(workDir, 'bad.tab');
    writeFileSync(badPath, 'this,is,not,tab,separated\nneither,is,this,one\n');
    const outputPath = join(workDir, 'morph-pl.json');
    const lockPath = join(workDir, 'morph-artifact.lock.json');

    await expect(compileFile({ inputPath: badPath, outputPath, lockPath })).rejects.toThrow(SgjpFormatError);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('end-to-end proof: fixture -> compile -> loadMorphData -> analyze/generate (the chain this tool exists for)', () => {
  let morph;
  let compiledArtifact;

  beforeAll(async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sgjp-compile-e2e-'));
    const outputPath = join(workDir, 'morph-pl.json');
    const result = await compileFile({
      inputPath: FIXTURE_PATH,
      outputPath,
      lockPath: join(workDir, 'morph-artifact.lock.json'),
      reportPath: join(workDir, 'COMPILE-REPORT.md'),
    });
    compiledArtifact = result.artifact;
    morph = loadMorphData(result.artifact); // the REAL production loader, unmodified
    rmSync(workDir, { recursive: true, force: true });
  });

  function analyze(value, attested = []) {
    return analyzePersonName(value, attested, morph);
  }

  it('loads without throwing (fail-closed validation in load.js passes on the compiled artifact)', () => {
    expect(morph.imiona.size).toBe(4);
    expect(morph.nazwiskaWyjatki.size).toBe(2); // Kozioł, Fischer — Wesołowski/Zawadzka were subtracted
    expect(morph.role.size).toBe(2);
  });

  it('a fully rule-predictable surname was subtracted, yet still inflects correctly at runtime via paradigms.js', () => {
    const a = analyze('Tomasz Wesołowski');
    expect(generateForm(a, new Set(['D']))).toEqual({ status: 'ok', tekst: 'Tomasza Wesołowskiego', przypadek: 'D', zrodlo: 'reguła' });
    expect(compiledArtifact.nazwiska.Wesołowski).toBeUndefined();
  });

  it('a feminine noun-class surname (different rule class, different gender) was also subtracted and still inflects', () => {
    const a = analyze('Ewa Kania');
    expect(generateForm(a, new Set(['D'])).tekst).toBe('Ewy Kani');
    expect(compiledArtifact.nazwiska.Kania).toBeUndefined();
  });

  it('the compiled Kozioł exception blocks a silent pick (variantness), exactly like the hand-written mini-lexicon fixture', () => {
    const a = analyze('Tomasz Kozioł');
    const g = generateForm(a, new Set(['D']));
    expect(g.status).toBe('flaga');
    expect(g.powod).toBe('wariantywne');
    expect(g.alternatywy.slice().sort()).toEqual(['Kozioła', 'Kozła']);
  });

  it('an attested variant of Kozioł resolves cleanly, sourced "poświadczona" — matching mini-lexicon.js bit for bit', () => {
    const a = analyze('Tomasz Kozioł', ['Kozła']);
    expect(generateForm(a, new Set(['D']))).toEqual({ status: 'ok', tekst: 'Kozła', przypadek: 'D', zrodlo: 'poświadczona' });
    // Cross-check against the EXISTING hand-written fixture's own values —
    // same real word, independently authored, must agree.
    expect(compiledArtifact.nazwiska.Kozioł.formy.D.slice().sort()).toEqual(MINI_LEXICON.nazwiska.Kozioł.formy.D.slice().sort());
  });

  it('a foreign-orthography surname becomes declinable ONLY because the compiler put it in the dictionary', () => {
    const a = analyze('Ewa Fischer');
    const g = generateForm(a, new Set(['D']));
    expect(g).toEqual({ status: 'ok', tekst: 'Ewy Fischera', przypadek: 'D', zrodlo: 'słownik' });
  });

  it('a given name attested with a single case compiles a sparse paradigm; fullParadigm surfaces the rest as explicit gaps, never fabricated', () => {
    const a = analyze('Marek');
    const paradigm = fullParadigm(a);
    expect(paradigm.M).toBe('Marek');
    expect(paradigm.D).toBeNull();
  });

  it('compiled role paradigms match the existing hand-written mini-lexicon.js entries exactly', () => {
    expect(compiledArtifact.role.powód).toEqual(MINI_LEXICON.role.powód);
    expect(compiledArtifact.role.pozwany).toEqual(MINI_LEXICON.role.pozwany);
  });

  it('Maria compiles "m/f" (two genders attested) with a paradigm matching mini-lexicon.js\'s own hand-typed Maria', () => {
    expect(morph.imiona.get('maria').rodzaj).toBe('m/f');
    expect(compiledArtifact.imiona.maria.paradygmat).toEqual(MINI_LEXICON.imiona.maria.paradygmat);
  });
});
