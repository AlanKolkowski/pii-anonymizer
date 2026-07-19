// FL-1a/FL-1b compiler (FLEKSJA-IMPL-PLAN.md SS1.4, SS2.2; parent spec
// W1-W3-MORPHOLOGY-DESIGN.md SS1): reads a Słownik gramatyczny języka
// polskiego (SGJP) "tab" dictionary dump — the same plain-text source
// format Morfeusz 2 compiles into its FSA dictionaries — and produces
// src/verifier/morph/data/morph-pl.json in EXACTLY the shape load.js
// (loadMorphData) expects: { meta, imiona, nazwiska, role }.
//
// Scope of THIS script: Z1 (SGJP) only. Z2/Z3 (PESEL given-name/surname
// frequency lists) are a separate merge step the design doc anticipates
// (FLEKSJA-IMPL-PLAN.md SS2.1) but this compiler does not implement —
// every compiled `imiona` entry gets frek: 0 (load.js's own documented
// default for "no frequency data"), never a fabricated number.
//
// Format grounding (do not invent, per the task brief): the tab-separated,
// forma/lemat/tag/klasyfikacja[/kwalifikatory] column shape and the
// colon-segmented, positionally-decoded tag grammar (case/gender/number
// tokens can appear at ANY segment position — "the first position
// determines the grammatical class; further positions follow uniquely
// from the class", Morfeusz2.pdf) are confirmed against public Morfeusz/
// SGJP build-input documentation (morfeusz-sgjp.tagset on the SGJP GitLab;
// a public PoliMorfSmall.tab structural sample). The EXACT literal
// classification-label strings the real sgjp-*.tab.gz dump uses for
// personal names (this script assumes "imię" / "nazwisko", matching the
// vocabulary FLEKSJA-IMPL-PLAN.md/W1-W3-MORPHOLOGY-DESIGN.md already use)
// are NOT independently confirmed here — W1-W3-MORPHOLOGY-DESIGN.md SS1.1
// says so explicitly ("dokładną semantykę kolumn i etykiet klasyfikacji
// kompilator przybija testem na nagłówku pobranego pliku przy implementacji
// – nie zakładamy jej z pamięci"). CLASSIFICATION below is a config object
// for exactly that reason: one-line fix if the real dump differs, and
// compileFile()'s report prints every distinct label actually observed so
// the assumption is checked, not hoped for. See docs/sgjp-compile.md.
//
// Streaming discipline (contract: peak memory bounded by VOCABULARY size,
// never by file size): every pass over the input reads the file — after
// on-the-fly gunzip when the extension is .gz — one line at a time via
// node:readline; nothing calls readFile() on the (potentially hundreds of
// MB decompressed) source. The one exception is hashing the RAW input file
// for the lock's provenance record, which also streams (crypto.Hash is a
// Transform stream; see sha256OfFile).
//
// Fail-closed philosophy (never produce silent garbage): validateShape()
// samples the first N lines and refuses before any real work if the file
// doesn't look tab/SGJP-shaped; a malformed data row anywhere aborts the
// whole compile (no partial artifact); an artifact whose gender/case cells
// conflict in a way the target JSON shape cannot represent aborts rather
// than silently picking one side. See compile-sgjp.test.js for the matrix.
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSurnameParadigm } from '../src/verifier/morph/paradigms.js';
import { MORPH_FORMAT_VERSION } from '../src/verifier/morph/load.js';
import { ROLE_LEMMAS } from '../src/verifier/case-detector/role-lemmas.js';

export class SgjpFormatError extends Error {}

// --- SGJP/Morfeusz tagset grounding (SS above) ------------------------------

// Polish case names (project alphabet, src/tokens.js) <- Morfeusz tag tokens.
const CASE_TOKENS = { nom: 'M', gen: 'D', dat: 'C', acc: 'B', inst: 'N', loc: 'Ms', voc: 'W' };
// m1 (masculine personal) / m2 (animal) / m3 (inanimate) all collapse to the
// engine's binary 'm'; genuinely neuter tags (n1/n2/n) are simply never
// personal-name-relevant and fall out of every recognized-gender check below.
const GENDER_TOKENS = { m1: 'm', m2: 'm', m3: 'm', f: 'f' };
const NUMBER_TOKENS = new Set(['sg', 'pl']);

/**
 * Scans EVERY colon-segment of a Morfeusz tag for case/gender/number token
 * membership (dot-combined syncretic segments, e.g. "nom.acc", are split
 * further) — position-independent by design, since tag layout varies by
 * grammatical class and this script does not hard-code per-class offsets.
 */
export function splitTag(tag) {
  const segments = String(tag).split(':').filter((s) => s.length > 0);
  const cases = new Set();
  const genders = new Set();
  const numbers = new Set();
  for (const segment of segments) {
    for (const token of segment.split('.')) {
      if (token in CASE_TOKENS) cases.add(CASE_TOKENS[token]);
      else if (token in GENDER_TOKENS) genders.add(GENDER_TOKENS[token]);
      else if (NUMBER_TOKENS.has(token)) numbers.add(token);
    }
  }
  return { segments, cases: [...cases], genders: [...genders], numbers: [...numbers] };
}

// --- classification config (SS above: NOT assumed from memory) -------------

export const DEFAULT_CLASSIFICATION = { givenName: 'imię', surname: 'nazwisko', common: 'pospolita' };

// --- row parsing -------------------------------------------------------------

const MIN_COLUMNS = 4;

/**
 * Parses one physical line. Returns:
 *   null                          — blank line or "#" comment (skip, never
 *                                    fed to the compiler; real SGJP dumps
 *                                    are not known to use "#" comments —
 *                                    this is a defensive convenience for
 *                                    the fixture and hand-edited inputs)
 *   { ok:false, reason }          — malformed (caller decides fail-closed
 *                                    policy; compileFromLines always throws)
 *   { ok:true, forma, lemat,
 *     lemmaHomonym, tag,
 *     klasyfikacja, kwalifikatory } — a data row
 */
export function parseTabLine(rawLine) {
  const line = rawLine.replace(/\r$/, ''); // tolerate CRLF (Windows checkout, core.autocrlf=true)
  if (line.trim() === '') return null;
  if (line.startsWith('#')) return null;
  const cols = line.split('\t');
  if (cols.length < MIN_COLUMNS) {
    return { ok: false, reason: `oczekiwano >= ${MIN_COLUMNS} kolumn oddzielonych tabulacją, otrzymano ${cols.length}: ${JSON.stringify(rawLine.slice(0, 80))}` };
  }
  const [formaRaw, lematRaw, tag, klasyfikacja, kwalifikatoryRaw = ''] = cols;
  if (!formaRaw || !lematRaw || !tag || !klasyfikacja) {
    return { ok: false, reason: `pusta wymagana kolumna: ${JSON.stringify(rawLine.slice(0, 80))}` };
  }
  const [lemat, homonymRaw] = lematRaw.split(':');
  return {
    ok: true,
    forma: formaRaw,
    lemat,
    lemmaHomonym: homonymRaw ? Number(homonymRaw) : null,
    tag,
    klasyfikacja,
    kwalifikatory: kwalifikatoryRaw ? kwalifikatoryRaw.split('|').filter(Boolean) : [],
  };
}

// --- fail-closed shape gate --------------------------------------------------

const TAG_SHAPE_RE = /^[a-z][a-z0-9]*(:[a-z0-9]+(\.[a-z0-9]+)*)*$/i;

/**
 * Samples a handful of lines and decides whether the file looks like an
 * SGJP tab dump at all, BEFORE any streaming pass runs. Never throws itself
 * — returns a verdict the caller (compileFile) escalates fail-closed.
 */
export function validateShape(sampleLines, { minRecognizedTagRatio = 0.5 } = {}) {
  const problems = [];
  let sampled = 0;
  let malformed = 0;
  let tagLike = 0;
  for (const raw of sampleLines) {
    const parsed = parseTabLine(raw);
    if (parsed === null) continue;
    sampled++;
    if (!parsed.ok) {
      malformed++;
      problems.push(parsed.reason);
      continue;
    }
    if (TAG_SHAPE_RE.test(parsed.tag)) tagLike++;
  }
  if (sampled === 0) problems.push('próbka nie zawiera żadnego wiersza danych (same puste linie / komentarze)');
  if (malformed > 0) problems.push(`${malformed}/${sampled} próbkowanych wierszy ma nieoczekiwaną liczbę kolumn (oczekiwano >= ${MIN_COLUMNS} rozdzielonych tabulacją)`);
  if (sampled > 0 && tagLike / sampled < minRecognizedTagRatio) {
    problems.push(`tylko ${tagLike}/${sampled} próbkowanych tagów wygląda jak gramatyka SGJP (segmenty rozdzielone dwukropkiem, np. "subst:sg:nom:m1")`);
  }
  return { ok: problems.length === 0, sampled, malformed, tagLike, problems };
}

// --- streaming line source (never loads the file whole) --------------------

function openLineStream(filePath) {
  const fileStream = createReadStream(filePath);
  const source = filePath.endsWith('.gz') ? fileStream.pipe(createGunzip()) : fileStream;
  return createInterface({ input: source, crlfDelay: Infinity });
}

/** Async-iterates the file's lines one at a time (auto-gunzip on .gz). */
export async function* readLines(filePath) {
  let first = true;
  for await (const line of openLineStream(filePath)) {
    if (first) {
      first = false;
      yield line.replace(/^﻿/, ''); // strip a UTF-8 BOM if present
      continue;
    }
    yield line;
  }
}

/** Reads raw lines up to the first `n` DATA-OR-MALFORMED rows (comments and
 * blank lines are read past, not counted) — an arbitrarily long leading
 * comment header (a fixture disclaimer, say) must never starve the shape
 * sample down to zero real rows. Returned lines still include any
 * interspersed comments/blanks verbatim; validateShape re-parses and skips
 * them the same way it always does. */
export async function peekLines(filePath, n = 30) {
  const out = [];
  let dataLike = 0;
  for await (const line of readLines(filePath)) {
    out.push(line);
    if (parseTabLine(line) !== null) dataLike++;
    if (dataLike >= n) break;
  }
  return out;
}

/** Streams sha256 of the RAW input file bytes (pre-gunzip) — never buffers
 * the whole file; crypto.Hash is itself a Transform stream. */
async function sha256OfFile(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

// --- license notice (task requirement: BSD-2 disclaimer travels WITH the
// artifact, not only in docs — §1.2.1/§1.2.4 W1-W3-MORPHOLOGY-DESIGN.md) --

export const SGJP_LICENSE_NOTICE = [
  'SGJP - Słownik gramatyczny języka polskiego (dane fleksyjne).',
  'Copyright (c) Zygmunt Saloni, Włodzimierz Gruszczyński, Marcin Woliński,',
  'Robert Wołosz, Danuta Skowrońska. Licencja: BSD-2-Clause (deklaracja:',
  'http://morfeusz.sgjp.pl/doc/license/). Redistribution and use in source',
  'and binary forms are permitted under the two-clause BSD terms; this',
  'notice and the disclaimer must be reproduced in the documentation or',
  'other materials provided with the distribution - satisfied by',
  'THIRD_PARTY_NOTICES.md (W1-W3-MORPHOLOGY-DESIGN.md SS1.2.1/SS1.2.4).',
  'This artifact contains ONLY a compiled subset (given names, surnames,',
  'procedural role nouns) of the source data (subtractive dictionary,',
  'FLEKSJA-IMPL-PLAN.md SS1.4.2).',
].join('\n');

// --- helpers shared by the three sections -----------------------------------

function sortObjectKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort((a, b) => a.localeCompare(b, 'pl')).map((k) => [k, obj[k]]));
}

function addForm(byCase, caseCode, forma) {
  const set = byCase.get(caseCode) ?? new Set();
  set.add(forma);
  byCase.set(caseCode, set);
}

function caseSetsAgree(a, b) {
  if (a.size !== b.size) return false;
  for (const f of a) if (!b.has(f)) return false;
  return true;
}

// --- the compiler proper -----------------------------------------------------

/**
 * compileFromLines(lines, options) -> { artifact, report, stats }
 *
 * `lines` is any async-iterable of raw text lines (readLines(path), or a
 * plain array/generator in tests). Throws SgjpFormatError fail-closed on
 * any malformed row, unrepresentable gender/case conflict, or a data set
 * that never shows a single recognized classification label.
 */
export async function compileFromLines(lines, options = {}) {
  const {
    roleLemmas = ROLE_LEMMAS,
    classification = DEFAULT_CLASSIFICATION,
    sourceLabel = 'unknown',
  } = options;
  const roleLemmaSet = new Set(roleLemmas);

  const givenNames = new Map(); // lowercased lemma -> Map<gender, Map<case, Set<forma>>>
  const surnames = new Map(); // lemma (original case) -> Map<gender, Map<case, Set<forma>>>
  const roleForms = new Map(); // lemma (original case) -> Map<case, Set<forma>>
  const classificationCounts = new Map();
  const anomalies = [];

  let totalRows = 0;
  let malformedRows = 0;
  let skippedNoGender = 0;
  let skippedPlural = 0;

  for await (const raw of lines) {
    const parsed = parseTabLine(raw);
    if (parsed === null) continue;
    totalRows++;
    if (!parsed.ok) {
      malformedRows++;
      throw new SgjpFormatError(`wiersz ${totalRows}: ${parsed.reason}`);
    }
    classificationCounts.set(parsed.klasyfikacja, (classificationCounts.get(parsed.klasyfikacja) ?? 0) + 1);

    const tagInfo = splitTag(parsed.tag);
    if (tagInfo.numbers.length > 0 && !tagInfo.numbers.includes('sg')) {
      skippedPlural++;
      continue; // v1 scope is singular paradigms only (FLEKSJA-IMPL-PLAN.md SS1.4.1 "lp")
    }
    if (tagInfo.cases.length === 0) continue; // no case info at all — not a form we can place

    if (parsed.klasyfikacja === classification.givenName) {
      if (tagInfo.genders.length === 0) { skippedNoGender++; continue; }
      const key = parsed.lemat.toLocaleLowerCase('pl');
      const entry = givenNames.get(key) ?? new Map();
      for (const g of tagInfo.genders) {
        const byCase = entry.get(g) ?? new Map();
        for (const c of tagInfo.cases) addForm(byCase, c, parsed.forma);
        entry.set(g, byCase);
      }
      givenNames.set(key, entry);
    } else if (parsed.klasyfikacja === classification.surname) {
      if (tagInfo.genders.length === 0) { skippedNoGender++; continue; }
      const entry = surnames.get(parsed.lemat) ?? new Map();
      for (const g of tagInfo.genders) {
        const byCase = entry.get(g) ?? new Map();
        for (const c of tagInfo.cases) addForm(byCase, c, parsed.forma);
        entry.set(g, byCase);
      }
      surnames.set(parsed.lemat, entry);
    } else if (parsed.klasyfikacja === classification.common && roleLemmaSet.has(parsed.lemat)) {
      const byCase = roleForms.get(parsed.lemat) ?? new Map();
      for (const c of tagInfo.cases) addForm(byCase, c, parsed.forma);
      roleForms.set(parsed.lemat, byCase);
    }
    // Any other classification label, or a "pospolita" row whose lemma is
    // not a known role lemma, is irrelevant to morph-pl.json — counted
    // above (classificationCounts / COMPILE-REPORT.md) but not stored.
  }

  if (totalRows === 0) {
    throw new SgjpFormatError('brak danych do skompilowania: strumień wejściowy nie zawierał żadnego wiersza (same puste linie / komentarze)');
  }
  const recognizedLabels = [classification.givenName, classification.surname, classification.common];
  if (!recognizedLabels.some((l) => classificationCounts.has(l))) {
    throw new SgjpFormatError(
      `żadna z rozpoznawanych etykiet klasyfikacji (${recognizedLabels.join(', ')}) nie wystąpiła w danych — `
      + `zaobserwowano: ${[...classificationCounts.keys()].join(', ') || '(brak)'}. `
      + 'Sprawdź realny plik i ewentualnie dopasuj opcję "classification" (docs/sgjp-compile.md).',
    );
  }

  // --- imiona --------------------------------------------------------------
  const imiona = {};
  for (const [lemma, byGender] of givenNames) {
    const genders = [...byGender.keys()];
    for (const g of genders) {
      if (g !== 'm' && g !== 'f') throw new SgjpFormatError(`imię "${lemma}": nierozpoznany rodzaj "${g}"`);
    }
    const rodzaj = genders.length > 1 ? 'm/f' : genders[0];
    let bestGender = genders[0];
    let bestCount = -1;
    for (const g of genders) {
      const n = byGender.get(g).size;
      if (n > bestCount) { bestGender = g; bestCount = n; }
    }
    const paradygmat = {};
    for (const [caseCode, forms] of byGender.get(bestGender)) {
      if (forms.size > 1) {
        throw new SgjpFormatError(`imię "${lemma}", przypadek ${caseCode}: sprzeczne formy (${[...forms].sort().join('/')}) — imiona nie obsługują wariantywności w tym kompilatorze`);
      }
      paradygmat[caseCode] = [...forms][0];
    }
    imiona[lemma] = { rodzaj, paradygmat, frek: 0 };
  }

  // --- nazwiska (subtractive dictionary, FLEKSJA-IMPL-PLAN.md SS1.4.2) ------
  const nazwiska = {};
  const ruleAgreement = new Map(); // klasaKey -> { total, subtracted, exceptions }

  for (const [lemma, byGender] of surnames) {
    const genderList = [...byGender.keys()];
    let byCase = byGender.get(genderList[0]);
    const gender = genderList[0];
    for (const g of genderList.slice(1)) {
      const other = byGender.get(g);
      for (const [caseCode, forms] of other) {
        const existing = byCase.get(caseCode);
        if (existing && !caseSetsAgree(existing, forms)) {
          throw new SgjpFormatError(
            `nazwisko "${lemma}": rozbieżne formy między rodzajami dla przypadku ${caseCode} `
            + `(${[...existing].sort().join('/')} vs ${[...forms].sort().join('/')}) — `
            + 'format artefaktu (load.js) nie rozróżnia rodzaju w kluczu lematu nazwiska',
          );
        }
      }
      const merged = new Map([...byCase].map(([c, s]) => [c, new Set(s)]));
      for (const [caseCode, forms] of other) {
        const set = merged.get(caseCode) ?? new Set();
        for (const f of forms) set.add(f);
        merged.set(caseCode, set);
      }
      byCase = merged;
    }

    const ruleResult = generateSurnameParadigm(lemma, gender);
    const klasaKey = ruleResult.status === 'ok' ? ruleResult.klasa : `flaga:${ruleResult.powod}`;
    const bucket = ruleAgreement.get(klasaKey) ?? { total: 0, subtracted: 0, exceptions: 0 };
    bucket.total++;

    let diverges = ruleResult.status !== 'ok';
    if (!diverges) {
      for (const [caseCode, forms] of byCase) {
        const predicted = ruleResult.paradygmat[caseCode];
        if (!(forms.size === 1 && predicted != null && [...forms][0] === predicted)) { diverges = true; break; }
      }
    }

    if (diverges) {
      bucket.exceptions++;
      const formy = {};
      let warianty = false;
      for (const [caseCode, forms] of byCase) {
        const sorted = [...forms].sort((a, b) => a.localeCompare(b, 'pl'));
        formy[caseCode] = sorted.length > 1 ? sorted : sorted[0];
        if (sorted.length > 1) warianty = true;
      }
      nazwiska[lemma] = { formy, warianty };
    } else {
      bucket.subtracted++;
    }
    ruleAgreement.set(klasaKey, bucket);
  }

  // --- role (full singular paradigm, transcribed verbatim) ------------------
  const role = {};
  for (const [lemma, byCase] of roleForms) {
    const paradygmat = {};
    for (const [caseCode, forms] of byCase) {
      if (forms.size > 1) {
        throw new SgjpFormatError(`rola "${lemma}", przypadek ${caseCode}: sprzeczne formy (${[...forms].sort().join('/')})`);
      }
      paradygmat[caseCode] = [...forms][0];
    }
    role[lemma] = paradygmat;
  }

  const artifact = {
    meta: {
      wersjaFormatu: MORPH_FORMAT_VERSION,
      zrodla: {
        sgjp: {
          input: sourceLabel,
          license: 'BSD-2-Clause',
          licenseUrl: 'http://morfeusz.sgjp.pl/doc/license/',
          notice: SGJP_LICENSE_NOTICE,
        },
      },
    },
    imiona: sortObjectKeys(imiona),
    nazwiska: sortObjectKeys(nazwiska),
    role: sortObjectKeys(role),
  };

  const ruleAgreementObj = Object.fromEntries(
    [...ruleAgreement.entries()].sort(([a], [b]) => a.localeCompare(b, 'pl'))
      .map(([klasa, c]) => [klasa, { ...c, rate: c.total > 0 ? c.subtracted / c.total : null }]),
  );

  const stats = {
    totalRows,
    malformedRows,
    skippedNoGender,
    skippedPlural,
    classificationCounts: Object.fromEntries([...classificationCounts.entries()].sort(([a], [b]) => a.localeCompare(b, 'pl'))),
    counts: { imiona: Object.keys(imiona).length, nazwiska: Object.keys(nazwiska).length, role: Object.keys(role).length },
    ruleAgreement: ruleAgreementObj,
  };

  const report = { stats, anomalies, sourceLabel };
  return { artifact, report, stats };
}

// --- human-readable compile report (§1.4.4 W1-W3-MORPHOLOGY-DESIGN.md) -----

function renderReport({ stats, sourceLabel }, lock) {
  const lines = [];
  lines.push('# COMPILE-REPORT');
  lines.push('');
  lines.push(`Źródło: \`${sourceLabel}\` (sha256 wejścia: ${lock.input.sha256 ?? '(nieznana)'})`);
  lines.push(`Wygenerowano: ${lock.generatedAt}`);
  lines.push('');
  lines.push('## Liczności sekcji');
  lines.push('');
  lines.push('| Sekcja | Liczba lematów |');
  lines.push('|---|---|');
  lines.push(`| imiona | ${stats.counts.imiona} |`);
  lines.push(`| nazwiska (wyjątki słownikowe) | ${stats.counts.nazwiska} |`);
  lines.push(`| role | ${stats.counts.role} |`);
  lines.push('');
  lines.push('## Zgodność reguł per klasa (słownik odejmujący, FLEKSJA-IMPL-PLAN.md SS1.4.2)');
  lines.push('');
  lines.push('| Klasa | Leksemy | Odjęte (zgodne z regułą) | Wyjątki (rozbieżne) | Zgodność |');
  lines.push('|---|---|---|---|---|');
  for (const [klasa, c] of Object.entries(stats.ruleAgreement)) {
    const rate = c.rate == null ? '—' : `${(c.rate * 100).toFixed(1)}%`;
    lines.push(`| ${klasa} | ${c.total} | ${c.subtracted} | ${c.exceptions} | ${rate} |`);
  }
  lines.push('');
  lines.push('## Etykiety klasyfikacji zaobserwowane w danych');
  lines.push('');
  lines.push('Sprawdź to ręcznie, jeśli kompilujesz realny zrzut SGJP po raz pierwszy —');
  lines.push('`compile-sgjp.mjs` zakłada etykiety "imię" / "nazwisko" / "pospolita"');
  lines.push('(patrz nagłówek skryptu i docs/sgjp-compile.md).');
  lines.push('');
  lines.push('| Etykieta | Liczba wierszy |');
  lines.push('|---|---|');
  for (const [label, count] of Object.entries(stats.classificationCounts)) {
    lines.push(`| ${label} | ${count} |`);
  }
  lines.push('');
  lines.push(`Wiersze pominięte: brak liczby/rodzaju rozpoznanego w tagu: ${stats.skippedNoGender}; liczba mnoga (poza zakresem v1): ${stats.skippedPlural}.`);
  lines.push('');
  lines.push('## Licencja');
  lines.push('');
  lines.push('```');
  lines.push(SGJP_LICENSE_NOTICE);
  lines.push('```');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// --- file-level orchestration: shape gate -> compile -> write (fail-closed) -

/**
 * compileFile(opts) -> { artifact, report, stats, lock, outputPath, lockPath, reportPath }
 *
 * Fail-closed ordering matters: the shape sample is validated BEFORE any
 * output path is touched, and compileFromLines runs to completion (in
 * memory, over the streamed input) BEFORE any file is written — a thrown
 * SgjpFormatError at any point leaves the filesystem exactly as it was.
 */
export async function compileFile({
  inputPath,
  outputPath,
  lockPath,
  reportPath,
  roleLemmas,
  classification,
  sampleSize = 30,
}) {
  const sample = await peekLines(inputPath, sampleSize);
  const shape = validateShape(sample);
  if (!shape.ok) {
    throw new SgjpFormatError(`plik "${inputPath}" nie wygląda na zrzut SGJP .tab:\n- ${shape.problems.join('\n- ')}`);
  }

  const { artifact, report, stats } = await compileFromLines(readLines(inputPath), {
    roleLemmas,
    classification,
    sourceLabel: basename(inputPath),
  });

  const artifactJson = `${JSON.stringify(artifact, null, 2)}\n`;
  const sha256 = createHash('sha256').update(artifactJson, 'utf8').digest('hex');
  const inputSha256 = await sha256OfFile(inputPath);

  const lock = {
    artifact: outputPath,
    formatVersion: MORPH_FORMAT_VERSION,
    sha256,
    sizeBytes: Buffer.byteLength(artifactJson, 'utf8'),
    generatedAt: new Date().toISOString(),
    compiler: 'scripts/compile-sgjp.mjs',
    input: { file: inputPath, sha256: inputSha256 },
    counts: stats.counts,
    license: { spdx: 'BSD-2-Clause', url: 'http://morfeusz.sgjp.pl/doc/license/' },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, artifactJson);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  if (reportPath) await writeFile(reportPath, renderReport(report, lock));

  return { artifact, report, stats, lock, outputPath, lockPath, reportPath };
}

// --- CLI entry point (only when run directly, mirrors scripts/verify-models.mjs) -

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) flags[m[1]] = m[2];
    else positional.push(a);
  }
  return { input: positional[0], ...flags };
}

async function main() {
  const { input, out, lock, report, 'sample-size': sampleSizeArg } = parseArgs(process.argv.slice(2));
  if (!input || !out) {
    console.error('Użycie: node scripts/compile-sgjp.mjs <sgjp.tab|sgjp.tab.gz> --out=<ścieżka morph-pl.json> [--lock=<ścieżka>] [--report=<ścieżka>] [--sample-size=N]');
    console.error('Zob. docs/sgjp-compile.md.');
    process.exitCode = 1;
    return;
  }
  const outputPath = resolve(out);
  const lockPath = resolve(lock ?? join(dirname(outputPath), 'morph-artifact.lock.json'));
  const reportPath = resolve(report ?? join(dirname(outputPath), 'COMPILE-REPORT.md'));
  const sampleSize = sampleSizeArg ? Number(sampleSizeArg) : undefined;

  const result = await compileFile({ inputPath: resolve(input), outputPath, lockPath, reportPath, sampleSize });
  console.log(`Skompilowano: ${outputPath}`);
  console.log(`  imiona=${result.stats.counts.imiona} nazwiska=${result.stats.counts.nazwiska} role=${result.stats.counts.role}`);
  console.log(`  sha256=${result.lock.sha256}`);
  console.log(`  raport: ${reportPath}`);
  console.log('');
  console.log(SGJP_LICENSE_NOTICE);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exitCode = 1;
  }
}
