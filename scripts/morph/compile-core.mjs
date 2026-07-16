// W1 (W1-W3-MORPHOLOGY-DESIGN.md §1.4): pure compilation core for the
// morphology artifact. NO I/O here — the CLI wrapper
// (scripts/compile-morph-data.mjs) reads verified files from
// scripts/.cache/morph/ and hands their contents in as strings; this module
// is unit-tested on small synthetic fixtures, so the logic is proven
// without the real datasets ever entering the repo (the datasets and their
// licenses go through the Opus gate O-3 first — see the design §1.2/§1.9).
//
// Subtractive dictionary (§1.4.2): the W2 rule engine (paradigms.js) is run
// over 100% of SGJP surname lexemes; only lexemes whose dictionary paradigm
// DIVERGES from the rule prediction enter the artifact. Agreement per class
// is measured and classes below the threshold are degraded to
// dictionary-only in the emitted config.

import { generateSurnameParadigm } from '../../src/verifier/morph/paradigms.js';
import { MORPH_FORMAT_VERSION } from '../../src/verifier/morph/load.js';
import { ROLE_LEMMAS } from '../../src/verifier/case-detector/role-lemmas.js';

export const AGREEMENT_THRESHOLD = 0.98;

// SGJP tagset case names → the S1 case alphabet (src/tokens.js).
const CASE_BY_TAG = {
  nom: 'M', gen: 'D', dat: 'C', acc: 'B', inst: 'N', loc: 'Ms', voc: 'W',
};

// --- .tab parsing (Z1) -------------------------------------------------------
//
// Assumed column semantics (forma, lemat, tag, klasyfikacja-nazwy,
// kwalifikatory; TSV; '#' comments). Per the design §1.1 this assumption is
// PINNED AGAINST THE REAL FILE at anchor time — parseTabFile validates shape
// hard and the anchor checklist includes eyeballing the parsed header
// sample, so a drift in the upstream format fails the compile, never
// silently mis-parses.

export function parseTabLine(line) {
  if (line === '' || line.startsWith('#')) return null;
  const cols = line.split('\t');
  if (cols.length < 3) throw new Error(`morph .tab: zły wiersz (kolumn: ${cols.length}): ${line.slice(0, 80)}`);
  const [forma, lemat, tag, klasyfikacja = '', kwalifikatory = ''] = cols;
  return { forma, lemat: lemat.split(':')[0], tag, klasyfikacja, kwalifikatory };
}

export function parseTabFile(content) {
  const rows = [];
  for (const line of content.split('\n')) {
    const row = parseTabLine(line.replace(/\r$/, ''));
    if (row) rows.push(row);
  }
  if (rows.length === 0) throw new Error('morph .tab: pusty plik');
  return rows;
}

function tagParts(tag) {
  return tag.split(':');
}

function isSingular(tag) {
  return tagParts(tag).includes('sg');
}

function tagCase(tag) {
  for (const part of tagParts(tag)) {
    // SGJP writes fused values like "nom.voc" — take every case named.
    const cases = part.split('.').map((p) => CASE_BY_TAG[p]).filter(Boolean);
    if (cases.length > 0) return cases;
  }
  return [];
}

function tagGender(tag) {
  const parts = tagParts(tag);
  if (parts.some((p) => p.split('.').includes('m1'))) return 'm';
  if (parts.some((p) => p.split('.').includes('f'))) return 'f';
  return null;
}

// Groups singular rows of one classification into lexemes:
// Map "lemma::gender" → { lemma, gender, formy: Map case → Set forms }.
export function collectLexemes(rows, classification) {
  const lexemes = new Map();
  for (const row of rows) {
    if (row.klasyfikacja !== classification) continue;
    if (!isSingular(row.tag)) continue;
    const gender = tagGender(row.tag);
    if (!gender) continue;
    const cases = tagCase(row.tag);
    if (cases.length === 0) continue;
    const key = `${row.lemat}::${gender}`;
    if (!lexemes.has(key)) {
      lexemes.set(key, { lemma: row.lemat, gender, formy: new Map() });
    }
    const entry = lexemes.get(key);
    for (const c of cases) {
      if (!entry.formy.has(c)) entry.formy.set(c, new Set());
      entry.formy.get(c).add(row.forma);
    }
  }
  return lexemes;
}

// --- PESEL CSV parsing (Z2/Z3) ----------------------------------------------
//
// dane.gov.pl resources vary in delimiter and header spelling; the parser
// detects both and validates hard — unidentifiable columns are an anchor
// blocker, not a guess.

function splitCsvLine(line, delimiter) {
  return line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, '').trim());
}

export function parsePeselCsv(content, kind) {
  const lines = content.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');
  if (lines.length < 2) throw new Error(`PESEL CSV (${kind}): pusty plik`);
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase());

  const findCol = (candidates) => {
    const idx = header.findIndex((h) => candidates.some((c) => h.includes(c)));
    if (idx === -1) {
      throw new Error(`PESEL CSV (${kind}): nie znajduję kolumny ${candidates.join('/')} w nagłówku: ${lines[0]}`);
    }
    return idx;
  };

  const nameCol = findCol(kind === 'imiona' ? ['imię', 'imie'] : ['nazwisko']);
  const countCol = findCol(['liczba', 'wystąpień', 'wystapien', 'count']);
  const genderCol = kind === 'imiona' ? findCol(['płeć', 'plec']) : null;

  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter);
    const name = cells[nameCol];
    const count = Number.parseInt(cells[countCol], 10);
    if (!name || !Number.isFinite(count)) continue;
    const record = { name, count };
    if (genderCol !== null) {
      const g = (cells[genderCol] ?? '').toLowerCase();
      record.gender = g.startsWith('k') || g.startsWith('f') ? 'f' : 'm';
    }
    out.push(record);
  }
  if (out.length === 0) throw new Error(`PESEL CSV (${kind}): zero rekordów po parsowaniu`);
  return out;
}

export function freqBucket(count) {
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.max(1, Math.min(6, Math.floor(Math.log10(count)) + 1));
}

// --- sections ---------------------------------------------------------------

function titleCase(name) {
  const lower = name.toLocaleLowerCase('pl');
  return lower.charAt(0).toLocaleUpperCase('pl') + lower.slice(1);
}

function paradigmObject(formy) {
  const out = {};
  for (const [c, forms] of formy) {
    const sorted = [...forms].sort();
    out[c] = sorted.length === 1 ? sorted[0] : sorted;
  }
  return out;
}

export function buildImionaSection({ tabRows, imionaCsv, minFrequency = 1 }) {
  const lexemes = collectLexemes(tabRows, 'imię');
  const byName = new Map();
  for (const { lemma, gender, formy } of lexemes.values()) {
    byName.set(`${titleCase(lemma)}::${gender}`, formy);
  }

  const section = {};
  for (const { name, gender, count } of imionaCsv) {
    if (count < minFrequency) continue;
    const canonical = titleCase(name);
    const formy = byName.get(`${canonical}::${gender}`);
    const key = canonical.toLocaleLowerCase('pl');
    const existing = section[key];
    const entry = {
      rodzaj: gender,
      paradygmat: formy ? paradigmObject(formy) : null,
      frek: freqBucket(count),
    };
    if (existing && existing.rodzaj !== gender) {
      // The same name on both PESEL lists (e.g. Maria as a second male
      // name): keep the higher-frequency reading's paradigm, mark m/f.
      const stronger = existing.frek >= entry.frek ? existing : entry;
      section[key] = { ...stronger, rodzaj: 'm/f' };
    } else if (!existing) {
      section[key] = entry;
    }
  }
  return section;
}

export function buildNazwiskaSection({ tabRows, classStatus = {} }) {
  const lexemes = collectLexemes(tabRows, 'nazwisko');
  const exceptions = {};
  const agreement = new Map(); // klasa → { total, zgodne }

  for (const { lemma, gender, formy } of lexemes.values()) {
    const rule = generateSurnameParadigm(lemma, gender, { classStatus });
    const klasa = rule.klasa ?? 'niesklasyfikowane';
    if (!agreement.has(klasa)) agreement.set(klasa, { total: 0, zgodne: 0 });
    const bucket = agreement.get(klasa);
    bucket.total += 1;

    let agrees = rule.status === 'ok';
    if (agrees) {
      for (const [c, forms] of formy) {
        const predicted = rule.paradygmat[c];
        if (forms.size !== 1 || predicted !== [...forms][0]) {
          agrees = false;
          break;
        }
      }
    }

    if (agrees) {
      bucket.zgodne += 1;
      continue; // the rules reproduce it at runtime — stays OUT of the artifact
    }
    const formyObj = {};
    let warianty = false;
    for (const [c, forms] of formy) {
      const sorted = [...forms].sort();
      formyObj[c] = sorted;
      if (sorted.length > 1) warianty = true;
    }
    const key = gender === 'f' ? `${lemma}::f` : lemma;
    exceptions[key] = { formy: formyObj, ...(warianty && { warianty: true }) };
  }

  const agreementTable = {};
  for (const [klasa, { total, zgodne }] of [...agreement.entries()].sort()) {
    const share = total === 0 ? 0 : zgodne / total;
    agreementTable[klasa] = {
      total,
      zgodne,
      procent: Math.round(share * 10000) / 100,
      zdegradowana: share < AGREEMENT_THRESHOLD,
    };
  }
  return { exceptions, agreementTable };
}

export function buildRoleSection({ tabRows }) {
  const section = {};
  const byLemma = new Map();
  for (const row of tabRows) {
    if (!isSingular(row.tag)) continue;
    if (!ROLE_LEMMAS.includes(row.lemat)) continue;
    const cases = tagCase(row.tag);
    if (cases.length === 0) continue;
    if (!byLemma.has(row.lemat)) byLemma.set(row.lemat, new Map());
    const formy = byLemma.get(row.lemat);
    for (const c of cases) {
      if (!formy.has(c)) formy.set(c, new Set());
      formy.get(c).add(row.forma);
    }
  }
  for (const [lemma, formy] of byLemma) {
    section[lemma] = paradigmObject(formy);
  }
  return section;
}

export function buildFrekwencjaSection({ nazwiskaCsv, topN = 500 }) {
  const sorted = [...nazwiskaCsv].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'));
  const nazwiska = {};
  for (const { name, count } of sorted.slice(0, topN)) {
    nazwiska[titleCase(name)] = freqBucket(count);
  }
  return { nazwiska };
}

// --- artifact assembly -------------------------------------------------------

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

/**
 * Full deterministic compilation (§1.4.3: no timestamps, everything sorted —
 * double compilation from the same inputs is byte-identical).
 *
 * @param {object} inputs
 * @param {string} inputs.sgjpTab - content of the SGJP .tab dump
 * @param {string} inputs.imionaCsv - content of the PESEL first-names CSV
 * @param {string} inputs.nazwiskaCsv - content of the PESEL surnames CSV
 * @param {object} inputs.zrodla - source versions from the lock (stamped into meta)
 * @param {object} [inputs.options] - { minFrequency, topN }
 */
export function compileMorphData({ sgjpTab, imionaCsv, nazwiskaCsv, zrodla, options = {} }) {
  const tabRows = parseTabFile(sgjpTab);
  const imionaRecords = parsePeselCsv(imionaCsv, 'imiona');
  const nazwiskaRecords = parsePeselCsv(nazwiskaCsv, 'nazwiska');

  const imiona = buildImionaSection({ tabRows, imionaCsv: imionaRecords, minFrequency: options.minFrequency ?? 1 });
  const { exceptions: nazwiska, agreementTable } = buildNazwiskaSection({ tabRows });
  const role = buildRoleSection({ tabRows });
  const frekwencja = buildFrekwencjaSection({ nazwiskaCsv: nazwiskaRecords, topN: options.topN ?? 500 });

  const klasyStatus = {};
  for (const [klasa, row] of Object.entries(agreementTable)) {
    if (row.zdegradowana) klasyStatus[klasa] = 'dictionary-only';
  }

  const artifact = sortDeep({
    meta: {
      wersjaFormatu: MORPH_FORMAT_VERSION,
      zrodla,
      klasyStatus,
      licznosci: {
        imiona: Object.keys(imiona).length,
        nazwiska: Object.keys(nazwiska).length,
        role: Object.keys(role).length,
        frekwencjaNazwisk: Object.keys(frekwencja.nazwiska).length,
      },
    },
    imiona,
    nazwiska,
    role,
    frekwencja,
  });

  const json = `${JSON.stringify(artifact, null, 1)}\n`;
  const report = buildReport({ artifact, agreementTable, jsonBytes: json.length });
  return { artifact, json, report, agreementTable };
}

function sampleKeys(section, n = 20) {
  return Object.keys(section).slice(0, n);
}

// §1.4.4: human-readable compile report — the gate's and every future
// regeneration PR's review material. Deterministic like the artifact.
export function buildReport({ artifact, agreementTable, jsonBytes }) {
  const { meta } = artifact;
  const lines = [
    '# COMPILE-REPORT — morph-pl.json',
    '',
    `Format: ${meta.wersjaFormatu}`,
    `Źródła: ${JSON.stringify(meta.zrodla)}`,
    '',
    '## Liczności sekcji',
    '',
    ...Object.entries(meta.licznosci).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Zgodność reguł per klasa (subtractive dictionary, §1.4.2)',
    '',
    '| klasa | leksemy | zgodne | % | status |',
    '|---|---|---|---|---|',
    ...Object.entries(agreementTable).map(([klasa, r]) =>
      `| ${klasa} | ${r.total} | ${r.zgodne} | ${r.procent}% | ${r.zdegradowana ? 'ZDEGRADOWANA → tylko-słownik' : 'reguła OK'} |`),
    '',
    '## Próbki (top-20 kluczy per sekcja)',
    '',
    `- imiona: ${sampleKeys(artifact.imiona).join(', ')}`,
    `- nazwiska (wyjątki): ${sampleKeys(artifact.nazwiska).join(', ')}`,
    `- role: ${sampleKeys(artifact.role).join(', ')}`,
    '',
    '## Rozmiar',
    '',
    `- surowy JSON: ${jsonBytes} B`,
    `- decyzja bytowania (§1.5): ${jsonBytes <= 5 * 1024 * 1024 ? 'bundle (app.asar, fuse integrity)' : jsonBytes <= 10 * 1024 * 1024 ? 'resources/ + manifest integrity' : 'STOP — ciąć zakres'}`,
    '',
  ];
  return lines.join('\n');
}
