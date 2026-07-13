// Holdout person pool for test-data/adversarial-holdout — RECALL-90-DESIGN.md
// §3.2/§3.4: values AND templates must be disjoint from the dev corpus
// (test-data/adversarial) so holdout measures generalization, not template
// memorization. Every given name and surname below was deliberately chosen
// to be absent from BOTH test-data/adversarial's 38 hand-written documents
// AND test-data/synthetic's 7 documents (checked by hand against both
// generator/ground-truth sources; holdout-disjointness.test.js re-checks
// this mechanically against the actual generated corpora, not just this
// list, so this comment is a design note, not the enforcement point).
//
// Declension: rather than hand-typing every case form (error-prone for
// Polish), adjectival surnames (-ski/-cki/-dzki, -ska/-cka/-dzka — the large
// majority of Polish surnames) are declined by a small mechanical rule:
// drop the final vowel/i, append the case ending. This is the same rule for
// every such surname regardless of the consonant cluster before it.
//
// Templates mostly refer to people by INTRODUCING them once as "Imię
// Nazwisko" (nominative) and then referring back by declined SURNAME ALONE
// for repeat mentions — mirroring the dev corpus's own pattern (adw_01:
// "Konrad Żurawski" once, then "Żurawskiego"/"Żurawskiemu" bare-surname on
// repeat). That sidesteps first-name declension entirely, which is the
// right call here: Polish feminine first names in -a have irregular dative
// consonant softening (Jadwiga→Jadwidze, Wanda→Wandzie) that isn't worth
// the error risk when the surname-alone pattern already covers the attack
// vector (fuzzyBackfill needs >=2 capitalized words — RECALL-90-DESIGN.md
// L1/adw_01's own attack note — so bare declined SURNAMES are exactly what
// stress-tests that gap, not full names).

/** Mechanical adjectival declension for -ski/-cki/-dzki (masc.) and
 * -ska/-cka/-dzka (fem.) surnames — the only pattern this pool's surnames
 * use. The stem consonant is a velar (k), which in Polish adjective
 * morphology takes the "soft" case endings: masc. -i/-iego/-iemu/-im, fem.
 * -a/-iej/-iej/-ą. Both endings share the same "...sk"/"...ck"/"...dzk"
 * stem, so dropping the final vowel and appending the case suffix is exact
 * for any surname of this shape. (Deliberately narrow: this is NOT a
 * general Polish adjective decliner — e.g. hard-stem adjectives like
 * "Ambroży" → "Ambrożego" take a different, -y/-ego/-emu/-ym pattern this
 * function doesn't implement, because no surname in this pool needs it.) */
export function declineAdjectivalSurname(nomSurname) {
  const feminine = nomSurname.endsWith('a');
  const masculine = nomSurname.endsWith('i');
  if (!feminine && !masculine) {
    throw new Error(`declineAdjectivalSurname: "${nomSurname}" is not in -ski/-cki/-dzki or -ska/-cka/-dzka form`);
  }
  const stem = nomSurname.slice(0, -1);
  if (feminine) {
    return { nom: nomSurname, gen: `${stem}iej`, dat: `${stem}iej`, inst: `${stem}ą` };
  }
  return { nom: nomSurname, gen: `${stem}iego`, dat: `${stem}iemu`, inst: `${stem}im` };
}

// ── Odmiana subclass (16 records: declension attack, mirrors dev adw_01-04) ──
// Each entry: given name (used once, nominative, at introduction) + an
// adjectival surname (declined for every repeat mention).
const ODMIANA_RAW = [
  ['Bogdan', 'Zieliński'], ['Mirosław', 'Szymański'], ['Ryszard', 'Kamiński'], ['Zenon', 'Lewandowski'],
  ['Kazimierz', 'Jankowski'], ['Wiesław', 'Piotrowski'], ['Marian', 'Pawłowski'], ['Andrzej', 'Michalski'],
  ['Bożena', 'Wróblewska'], ['Danuta', 'Zalewska'], ['Urszula', 'Górska'], ['Teresa', 'Witkowska'],
  ['Jadwiga', 'Głowacka'], ['Wanda', 'Kwaśniewska'], ['Zofia', 'Sobolewska'], ['Regina', 'Wojnowska'],
];

export const ODMIANA_PEOPLE = ODMIANA_RAW.map(([given, surname]) => {
  const d = declineAdjectivalSurname(surname);
  return {
    subclass: 'odmiana',
    given,
    surname,
    nom: `${given} ${surname}`,
    surnameNom: d.nom,
    surnameGen: d.gen,
    surnameDat: d.dat,
    surnameInst: d.inst,
  };
});

// ── Dwuczłonowe subclass (10 records: compound surnames, mirrors adw_03/07) ──
// Real Polish double-barrel surnames pair a fixed heraldic/clan first
// element (indeclinable) with a declining second element — exactly the
// pattern dev's own "Krzemień-Zawadzka" already uses (only "Zawadzka"
// visibly declines to "Zawadzkiej"; "Krzemień" stays fixed). The fixed
// first elements below are real Polish herb (heraldic clan) names.
const DWUCZLONOWE_RAW = [
  ['Longin', 'Grzymała', 'Siedlecki'], ['Zygmunt', 'Nałęcz', 'Korzeniewski'],
  ['Ambroży', 'Jastrzębiec', 'Wolski'], ['Bronisław', 'Radwan', 'Zdrojewski'],
  ['Gustaw', 'Łada', 'Podgórski'], ['Stefania', 'Korwin', 'Siedlecka'],
  ['Genowefa', 'Bończa', 'Korzeniewska'], ['Anastazja', 'Pomian', 'Wolska'],
  ['Marianna', 'Junosza', 'Zdrojewska'], ['Aldona', 'Rawicz', 'Podgórska'],
];

export const DWUCZLONOWE_PEOPLE = DWUCZLONOWE_RAW.map(([given, fixedPart, declinablePart]) => {
  const d = declineAdjectivalSurname(declinablePart);
  const join = (form) => `${fixedPart}-${form}`;
  return {
    subclass: 'dwuczlonowe',
    given,
    surname: join(d.nom),
    nom: `${given} ${join(d.nom)}`,
    surnameNom: join(d.nom),
    surnameGen: join(d.gen),
    surnameDat: join(d.dat),
    surnameInst: join(d.inst),
  };
});

// ── Inicjały subclass (20 records: nominative-only, mirrors adw_06/28) ──
// Dev's own initials examples ("K. Żurawski", "J. M.", "M.K.", "E. W.")
// never appear declined — nominative-only is the established precedent, not
// a shortcut taken here.
export const INICJALY_PEOPLE = [
  // Derived from odmiana/dwuczłonowe surnames with a bare initial (distinct
  // literal text from the full-name forms above — still disjoint from dev).
  'B. Zieliński', 'M. Szymański', 'R. Kamiński', 'Z. Lewandowski', 'K. Jankowski',
  'W. Piotrowski', 'M. Pawłowski', 'A. Michalski', 'B. Wróblewska', 'D. Zalewska',
  // Standalone double-initial "parafka" style, not tied to any full-name
  // record elsewhere (mirrors dev's "M.K." / "E. W." pattern).
  'T.N.', 'A.K.', 'G.P.', 'S.R.', 'L.B.', 'W.O.', 'H.Z.', 'F.M.', 'C.W.', 'N.J.',
].map((nom) => ({ subclass: 'inicjaly', nom }));

// ── Pospolite-pułapki subclass (18 records: common-noun surnames as a ──
// disambiguation trap, mirrors adw_05/33 — Kowal/Lis/Sad/Zamek/Baran/Wilk/
// Kos in dev). Surname reused VERBATIM (no declension) on repeat mentions,
// same precedent as dev's own "Sad usprawiedliwił..." pattern — these are
// common nouns first, so this generator does not attempt to adjudicate
// whether/how they'd decline as a surname.
const POSPOLITE_RAW = [
  ['Ignacy', 'Wróbel'], ['Leon', 'Kruk'], ['Norbert', 'Kot'], ['Roman', 'Struś'], ['Wacław', 'Kogut'],
  ['Edmund', 'Bąk'], ['Hubert', 'Żuk'], ['Klemens', 'Karp'], ['Feliks', 'Osioł'], ['Emil', 'Dzięcioł'],
  ['Helena', 'Kania'], ['Klara', 'Czapla'], ['Malwina', 'Sroka'], ['Otylia', 'Pszczoła'],
  ['Czesława', 'Jaskółka'], ['Ludmiła', 'Kukułka'], ['Bogumiła', 'Wrona'], ['Salomea', 'Papuga'],
];

export const POSPOLITE_PEOPLE = POSPOLITE_RAW.map(([given, surname]) => ({
  subclass: 'pospolite',
  given,
  surname,
  nom: `${given} ${surname}`,
  surnameNom: surname,
}));

export const ALL_HOLDOUT_PEOPLE = [
  ...ODMIANA_PEOPLE, ...DWUCZLONOWE_PEOPLE, ...INICJALY_PEOPLE, ...POSPOLITE_PEOPLE,
];

/** Every distinct literal surname-bearing string this pool can ever emit
 * (all case forms, all subclasses) — the raw material for the disjointness
 * test against the dev corpus. */
export function allPersonSurfaceForms() {
  const forms = new Set();
  for (const p of ALL_HOLDOUT_PEOPLE) {
    forms.add(p.nom);
    if (p.surnameNom) forms.add(p.surnameNom);
    if (p.surnameGen) forms.add(p.surnameGen);
    if (p.surnameDat) forms.add(p.surnameDat);
    if (p.surnameInst) forms.add(p.surnameInst);
  }
  return forms;
}
