import {
  declineAdjectivalSurname, ODMIANA_PEOPLE, DWUCZLONOWE_PEOPLE, INICJALY_PEOPLE, POSPOLITE_PEOPLE,
  ALL_HOLDOUT_PEOPLE, allPersonSurfaceForms,
} from './holdout-people.mjs';

describe('declineAdjectivalSurname', () => {
  it('matches hand-verified forms for known -ski/-ska surnames', () => {
    expect(declineAdjectivalSurname('Michalski')).toEqual({
      nom: 'Michalski', gen: 'Michalskiego', dat: 'Michalskiemu', inst: 'Michalskim',
    });
    expect(declineAdjectivalSurname('Kwaśniewska')).toEqual({
      nom: 'Kwaśniewska', gen: 'Kwaśniewskiej', dat: 'Kwaśniewskiej', inst: 'Kwaśniewską',
    });
  });

  it('rejects a surname not in -ski/-cki/-dzki(-a) form, including the different hard-stem -y pattern', () => {
    expect(() => declineAdjectivalSurname('Kowal')).toThrow();
    expect(() => declineAdjectivalSurname('Ambroży')).toThrow();
  });
});

describe('ODMIANA_PEOPLE / DWUCZLONOWE_PEOPLE: well-formed declension records', () => {
  for (const group of [ODMIANA_PEOPLE, DWUCZLONOWE_PEOPLE]) {
    it(`every record in a ${group.length}-entry group has 4 distinct-looking case forms and no undefined fields`, () => {
      for (const p of group) {
        expect(p.nom).toContain(p.given);
        expect(p.surnameNom).toBeTruthy();
        expect(p.surnameGen).toBeTruthy();
        expect(p.surnameDat).toBeTruthy();
        expect(p.surnameInst).toBeTruthy();
        // genitive/dative/instrumental must actually differ from the nominative
        // (otherwise this "declension" record isn't testing declension at all)
        expect(p.surnameGen).not.toBe(p.surnameNom);
        expect(p.surnameInst).not.toBe(p.surnameNom);
      }
    });
  }

  it('dwuczłonowe surnames keep the fixed first element identical across all four case forms', () => {
    for (const p of DWUCZLONOWE_PEOPLE) {
      const fixedPart = p.surnameNom.split('-')[0];
      expect(p.surnameGen.startsWith(`${fixedPart}-`)).toBe(true);
      expect(p.surnameDat.startsWith(`${fixedPart}-`)).toBe(true);
      expect(p.surnameInst.startsWith(`${fixedPart}-`)).toBe(true);
    }
  });
});

describe('gender field (needed for gender-agreeing honorifics in templates)', () => {
  it('every odmiana/dwuczlonowe/pospolite record has gender M or F', () => {
    for (const group of [ODMIANA_PEOPLE, DWUCZLONOWE_PEOPLE, POSPOLITE_PEOPLE]) {
      for (const p of group) expect(['M', 'F']).toContain(p.gender);
    }
  });

  it('odmiana gender matches the well-known feminine -ska/masculine -ski ending', () => {
    const zielinski = ODMIANA_PEOPLE.find((p) => p.surname === 'Zieliński');
    const wroblewska = ODMIANA_PEOPLE.find((p) => p.surname === 'Wróblewska');
    expect(zielinski.gender).toBe('M');
    expect(wroblewska.gender).toBe('F');
  });

  it('pospolite gender matches the documented male-then-female split (10 then 8)', () => {
    expect(POSPOLITE_PEOPLE.filter((p) => p.gender === 'M').length).toBe(10);
    expect(POSPOLITE_PEOPLE.filter((p) => p.gender === 'F').length).toBe(8);
    expect(POSPOLITE_PEOPLE.find((p) => p.given === 'Helena').gender).toBe('F');
    expect(POSPOLITE_PEOPLE.find((p) => p.given === 'Ignacy').gender).toBe('M');
  });
});

describe('pool sizing (RECALL-90-DESIGN.md §3.3 PERSON_NAME subclass targets)', () => {
  it('has the expected record counts per subclass', () => {
    expect(ODMIANA_PEOPLE.length).toBe(16);
    expect(DWUCZLONOWE_PEOPLE.length).toBe(10);
    expect(INICJALY_PEOPLE.length).toBe(20);
    expect(POSPOLITE_PEOPLE.length).toBe(18);
  });
});

describe('no internal duplicates', () => {
  it('every nom (introduction form) across the whole pool is unique', () => {
    const noms = ALL_HOLDOUT_PEOPLE.map((p) => p.nom);
    expect(new Set(noms).size).toBe(noms.length);
  });

  it('every surname (bare, nominative) across the whole pool is unique', () => {
    const surnames = ALL_HOLDOUT_PEOPLE.map((p) => p.surname).filter(Boolean);
    expect(new Set(surnames).size).toBe(surnames.length);
  });
});

// First-pass sanity check against a hand-compiled denylist of every surname
// used in the dev (test-data/adversarial) and synthetic (test-data/synthetic)
// corpora, extracted directly from their generator/ground-truth. This is a
// design-time guard; holdout-disjointness.test.js is the mechanical guard
// that re-derives the denylist from the actual generated corpora and is the
// one that would catch drift if either corpus changes later.
const DEV_AND_SYNTHETIC_SURNAMES = new Set([
  // test-data/adversarial (scripts/generate-adversarial-corpus.mjs)
  'Żurawski', 'Czyż', 'Mroczek-Sowińska', 'Krzemień-Zawadzka', 'Odrowąż-Pietraszek',
  'Wilk', 'Kos', 'Kowal', 'Lis', 'Baran', 'Sad', 'Szczygieł', 'Zamek', 'Gwóźdź',
  'Maj', 'Sosna', 'Jarzębina', 'Cis',
  // test-data/synthetic
  'Nowak', 'Wiśniewski', 'Jabłoński', 'Kwiatkowska', 'Kwiatkowski', 'Kowalczyk', 'Zając',
  'Dąbrowska', 'Malinowska', 'Malinowski', 'Kędzierski', 'Borowiak', 'Szczepańska',
  'Brzezińska', 'Kowalski', 'Pietrzak', 'Sikorski', 'Adamczyk', 'Czajka', 'Grabowski',
  'Woźniak', 'Rutkowska', 'Olejniczak', 'Szmajdziński', 'Grzesik', 'Kowalska', 'Dąbek',
  'Wiśniewicz', 'Mariusz',
]);

describe('disjointness (first pass, against the hand-compiled dev+synthetic denylist)', () => {
  it('no holdout surname equals a dev/synthetic surname', () => {
    const collisions = ALL_HOLDOUT_PEOPLE
      .map((p) => p.surname)
      .filter(Boolean)
      .filter((s) => DEV_AND_SYNTHETIC_SURNAMES.has(s));
    expect(collisions).toEqual([]);
  });
});

describe('allPersonSurfaceForms', () => {
  it('returns a non-empty set covering every nom and every declined surname form', () => {
    const forms = allPersonSurfaceForms();
    expect(forms.size).toBeGreaterThan(ALL_HOLDOUT_PEOPLE.length);
    for (const p of ODMIANA_PEOPLE) {
      expect(forms.has(p.surnameGen)).toBe(true);
    }
  });
});
