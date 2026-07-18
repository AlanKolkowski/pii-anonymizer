// K2/K3 (W1-W3-MORPHOLOGY-DESIGN.md SS2.4-2.7, FLEKSJA-IMPL-PLAN.md SS2.4):
// generateForm + fullParadigm — consumes analyzePersonName's analysis to
// actually produce a case-inflected form. Pure functions, no I/O.
//
// Precedence, per SS2.7/SS3.3: poświadczona (attested) > słownik (dictionary
// exception) > reguła (rule-generated). Never guesses: a target case set
// that genuinely can't collapse to ONE surface form (real ambiguity, not
// masculine-personal D=B syncretism) comes back as a flag with alternatives,
// never a picked value.
import { CASES, generateSurnameParadigm } from './paradigms.js';

// Builds ONE case's surface form by walking every word of the analysis.
// Returns { status: 'ok', tekst, zrodlo } or { status: 'flaga', powod, ... }.
function buildFormForCase(analiza, przypadek) {
  const parts = [];
  let usedRule = false;

  for (const slowo of analiza.slowa) {
    if (slowo.typ === 'inicjał') {
      parts.push(slowo.tekst);
      continue;
    }

    if (slowo.typ === 'imię') {
      const entry = analiza.morph?.imiona?.get(slowo.lemat.toLocaleLowerCase('pl'));
      const forma = entry?.paradygmat?.[przypadek];
      if (!forma) return { status: 'flaga', powod: entry ? 'nie-umiem-odmienić' : 'imię-nieznane' };
      parts.push(forma);
      continue;
    }

    // nazwisko / nazwisko-dwuczłonowe
    if (slowo.zrodloLematu === 'obce') return { status: 'flaga', powod: 'obce' };
    if (slowo.zrodloLematu === 'nieznane') return { status: 'flaga', powod: 'nie-umiem-odmienić' };

    if (slowo.zrodloLematu === 'słownik') {
      const dictEntry = analiza.morph?.nazwiskaWyjatki?.get(slowo.lemat);
      const formy = dictEntry?.formy?.[przypadek];
      if (!formy) return { status: 'flaga', powod: 'nie-umiem-odmienić' };
      const list = Array.isArray(formy) ? formy : [formy];
      if (list.length > 1) return { status: 'flaga', powod: 'wariantywne', alternatywy: list };
      parts.push(list[0]);
      continue;
    }

    // 'reguła': the word's own case-detection may have left gender open
    // (kandydaciRodzaju carries every gender that self-validated against
    // the INPUT form) — a resolved analiza.rodzaj always wins; otherwise
    // every candidate gender is tried and must agree, or it's a genuine
    // gender-dependent divergence, never a silent pick (R-FL-1 territory).
    const rodzajeDoSprawdzenia = analiza.rodzaj
      ? [analiza.rodzaj]
      : [...new Set((slowo.kandydaciRodzaju ?? []).map((k) => k.gender))];
    if (rodzajeDoSprawdzenia.length === 0) return { status: 'flaga', powod: 'rodzaj-niejednoznaczny' };

    const formySet = new Set();
    for (const rodzaj of rodzajeDoSprawdzenia) {
      const generated = generateSurnameParadigm(slowo.lemat, rodzaj);
      if (generated.status !== 'ok') continue;
      const forma = generated.paradygmat[przypadek];
      if (forma) formySet.add(forma);
    }
    if (formySet.size === 0) return { status: 'flaga', powod: 'nie-umiem-odmienić' };
    if (formySet.size > 1) return { status: 'flaga', powod: 'rodzaj-niejednoznaczny' };
    parts.push([...formySet][0]);
    usedRule = true;
  }

  return { status: 'ok', tekst: parts.join(' '), zrodlo: usedRule ? 'reguła' : 'słownik' };
}

/**
 * generateForm(analiza, zbiorPrzypadkow) (SS2.4): generates the surface form
 * for one of a SET of acceptable target cases (a case-detector cascade may
 * hand over more than one candidate case — e.g. masculine-personal D=B
 * syncretism, or genuine leftover ambiguity). Multiple target cases that all
 * resolve to the SAME text are not ambiguity (that IS the syncretism);
 * multiple target cases resolving to genuinely DIFFERENT text come back
 * flagged with every alternative, never picked.
 *
 * @param {object} analiza - analyzePersonName() result
 * @param {Set<string>|string[]} zbiorPrzypadkow - candidate case codes
 * @returns {{status:'ok', tekst, przypadek, zrodlo} | {status:'flaga', powod, alternatywy?}}
 */
export function generateForm(analiza, zbiorPrzypadkow) {
  if (!analiza || analiza.status !== 'ok') {
    return { status: 'flaga', powod: analiza?.powod ?? 'dane-niedostępne' };
  }
  const cases = [...new Set(zbiorPrzypadkow ?? [])];
  if (cases.length === 0) return { status: 'flaga', powod: 'przypadek-nieustalony' };

  // 1. Attested forms are authoritative the instant one covers a target case.
  for (const przypadek of cases) {
    const attested = analiza.poswiadczoneWgPrzypadka?.[przypadek];
    if (attested) return { status: 'ok', tekst: attested, przypadek, zrodlo: 'poświadczona' };
  }

  // 2. Generate per candidate case.
  const results = cases.map((przypadek) => [przypadek, buildFormForCase(analiza, przypadek)]);
  const ok = results.filter(([, r]) => r.status === 'ok');

  if (ok.length === 0) {
    // A single requested case surfaces its own specific flag; several
    // requested cases that ALL fail collapse to a generic refusal (the
    // per-case reasons may differ and there is no single case to pin it on).
    return results.length === 1 ? results[0][1] : { status: 'flaga', powod: 'nie-umiem-odmienić' };
  }

  const distinctTexts = new Set(ok.map(([, r]) => r.tekst));
  if (distinctTexts.size > 1) {
    return {
      status: 'flaga',
      powod: 'przypadek-nieustalony',
      alternatywy: ok.map(([przypadek, r]) => ({ przypadek, tekst: r.tekst })),
    };
  }

  const [przypadek, result] = ok[0];
  return { status: 'ok', tekst: result.tekst, przypadek, zrodlo: result.zrodlo };
}

/**
 * fullParadigm(analiza) (SS2.4): the complete 7-case view, built from
 * generateForm itself (same precedence/never-guess rules) so there is
 * exactly one generation code path. Unresolvable cases are explicit `null`
 * gaps — never thrown errors, never a guessed value (G20 discipline).
 *
 * @param {object} analiza - analyzePersonName() result
 * @returns {Record<'M'|'D'|'C'|'B'|'N'|'Ms'|'W', string|null>}
 */
export function fullParadigm(analiza) {
  const out = {};
  for (const przypadek of CASES) {
    const result = generateForm(analiza, [przypadek]);
    out[przypadek] = result.status === 'ok' ? result.tekst : null;
  }
  return out;
}
