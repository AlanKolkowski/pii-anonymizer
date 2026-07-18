// Mini test fixture for the morph-pl.json shape consumed by load.js
// (FLEKSJA-IMPL-PLAN.md SS8, FL-1a row: "mini-fixture ... hand-written test
// dictionary, NOT a full SGJP compilation"). Every form below is hand-typed
// by the author for this test suite only — zero content copied from any
// external dataset (SGJP/PoliMorf/PESEL), so no licensing question attaches
// to this file. The real artifact (FL-1b, full SGJP compile) is explicitly
// out of scope for this turn and is never produced or imported here.
//
// Deliberately small and varied: a handful of given names (including one
// gender-ambiguous "m/f" entry and one dictionary-miss with no compiled
// paradigm), one surname dictionary EXCEPTION with genuine variantness
// (Kozioł), and two role lemmas for the S-A apposition signal. Regular
// (rule-governed) surnames like "Kowalski"/"Nowak" deliberately do NOT
// appear here — paradigms.js generates those from the lemma alone, so the
// mini-fixture only needs to cover what a dictionary must supply.
export const MINI_LEXICON = {
  meta: {
    wersjaFormatu: 'morph-pl/1',
    zrodla: { fixture: 'hand-written test-only mini-lexicon, no external dataset content' },
  },
  imiona: {
    jan: {
      rodzaj: 'm',
      paradygmat: { M: 'Jan', D: 'Jana', C: 'Janowi', B: 'Jana', N: 'Janem', Ms: 'Janie', W: 'Janie' },
      frek: 10,
    },
    anna: {
      rodzaj: 'f',
      paradygmat: { M: 'Anna', D: 'Anny', C: 'Annie', B: 'Annę', N: 'Anną', Ms: 'Annie', W: 'Anno' },
      frek: 10,
    },
    piotr: {
      rodzaj: 'm',
      paradygmat: { M: 'Piotr', D: 'Piotra', C: 'Piotrowi', B: 'Piotra', N: 'Piotrem', Ms: 'Piotrze', W: 'Piotrze' },
      frek: 8,
    },
    // Gender-ambiguous dictionary entry (Maria is attested for both sexes in
    // Polish usage) — resolveGender must fall through to the surname/
    // attested-form signal for bearers of this given name (W1-W3 SS2.3).
    maria: {
      rodzaj: 'm/f',
      paradygmat: { M: 'Maria', D: 'Marii', C: 'Marii', B: 'Marię', N: 'Marią', Ms: 'Marii', W: 'Mario' },
      frek: 8,
    },
    // Dictionary HIT for typing/gender (rodzaj known) but a MISS for
    // generation (paradygmat: null) — exercises the "known name, can't
    // generate" path distinctly from "unknown name" (imię-nieznane).
    konrad: { rodzaj: 'm', paradygmat: null, frek: 3 },
  },
  nazwiska: {
    // Subtractive-dictionary exception: genuine vowel/consonant alternation
    // the closed rule tables cannot resolve without attestation, WITH
    // documented variantness (both forms are in real use) — R-FL-5.
    Kozioł: {
      formy: {
        M: ['Kozioł'],
        D: ['Kozła', 'Kozioła'],
        C: ['Kozłowi', 'Koziołowi'],
        B: ['Kozła', 'Kozioła'],
        N: ['Kozłem', 'Koziołem'],
        Ms: ['Koźle', 'Koziole'],
        W: ['Koźle', 'Koziole'],
      },
      warianty: true,
    },
  },
  role: {
    powód: { M: 'powód', D: 'powoda', C: 'powodowi', B: 'powoda', N: 'powodem', Ms: 'powodzie', W: 'powodzie' },
    pozwany: { M: 'pozwany', D: 'pozwanego', C: 'pozwanemu', B: 'pozwanego', N: 'pozwanym', Ms: 'pozwanym', W: 'pozwany' },
  },
};
