import {
  CASES,
  DEFAULT_CLASS_STATUS,
  classifySurname,
  generateSurnameParadigm,
  surnameLemmaCandidates,
  genderFromAdjectivalSurname,
  isForeignName,
} from './paradigms.js';

function paradigmOf(lemma, gender, options) {
  const out = generateSurnameParadigm(lemma, gender, options);
  expect(out.status, `${lemma} (${gender}) should generate`).toBe('ok');
  return out.paradygmat;
}

describe('generateSurnameParadigm — rule classes (W1-W3-MORPHOLOGY-DESIGN.md §2.4)', () => {
  it('adjectival -ski/-cki/-dzki masculine (fully productive)', () => {
    expect(paradigmOf('Żurawski', 'm')).toEqual({
      M: 'Żurawski', D: 'Żurawskiego', C: 'Żurawskiemu', B: 'Żurawskiego',
      N: 'Żurawskim', Ms: 'Żurawskim', W: 'Żurawski',
    });
    expect(paradigmOf('Zawadzki', 'm').D).toBe('Zawadzkiego');
    expect(paradigmOf('Sowiński', 'm').C).toBe('Sowińskiemu');
  });

  it('adjectival feminine -ska/-cka/-dzka', () => {
    expect(paradigmOf('Zawadzka', 'f')).toEqual({
      M: 'Zawadzka', D: 'Zawadzkiej', C: 'Zawadzkiej', B: 'Zawadzką',
      N: 'Zawadzką', Ms: 'Zawadzkiej', W: 'Zawadzka',
    });
    expect(paradigmOf('Sowińska', 'f').D).toBe('Sowińskiej');
  });

  it('noun masculine hard stems with the closed locative table', () => {
    expect(paradigmOf('Baran', 'm')).toEqual({
      M: 'Baran', D: 'Barana', C: 'Baranowi', B: 'Barana',
      N: 'Baranem', Ms: 'Baranie', W: 'Baranie',
    });
    expect(paradigmOf('Lis', 'm').Ms).toBe('Lisie');
    expect(paradigmOf('Mazur', 'm').Ms).toBe('Mazurze');
    expect(paradigmOf('Kot', 'm').Ms).toBe('Kocie');
    expect(paradigmOf('Sad', 'm').Ms).toBe('Sadzie');
    expect(paradigmOf('Zamek', 'm').D).toBe('Zamka');
  });

  it('velar and soft stems take the -u locative and -iem instrumental where due', () => {
    expect(paradigmOf('Wilk', 'm')).toMatchObject({ D: 'Wilka', N: 'Wilkiem', Ms: 'Wilku', W: 'Wilku' });
    expect(paradigmOf('Czyż', 'm')).toMatchObject({ D: 'Czyża', Ms: 'Czyżu' });
    expect(paradigmOf('Kowal', 'm')).toMatchObject({ C: 'Kowalowi', Ms: 'Kowalu' });
    expect(paradigmOf('Odrowąż', 'm')).toMatchObject({ D: 'Odrowąża', Ms: 'Odrowążu' });
  });

  it('soft-final stems join vowels orthographically (ń → ni)', () => {
    expect(paradigmOf('Krzemień', 'm')).toMatchObject({
      D: 'Krzemienia', C: 'Krzemieniowi', N: 'Krzemieniem', Ms: 'Krzemieniu',
    });
  });

  it('movable-e -ek (productive): Pietraszek → Pietraszka', () => {
    expect(paradigmOf('Pietraszek', 'm')).toEqual({
      M: 'Pietraszek', D: 'Pietraszka', C: 'Pietraszkowi', B: 'Pietraszka',
      N: 'Pietraszkiem', Ms: 'Pietraszku', W: 'Pietraszku',
    });
    expect(paradigmOf('Mroczek', 'm').D).toBe('Mroczka');
  });

  it('feminine noun -a with palatalized dative/locative', () => {
    expect(paradigmOf('Kozera', 'f')).toMatchObject({
      D: 'Kozery', C: 'Kozerze', B: 'Kozerę', N: 'Kozerą', Ms: 'Kozerze',
    });
    expect(paradigmOf('Sikora', 'f').C).toBe('Sikorze');
    expect(paradigmOf('Kania', 'f')).toMatchObject({ D: 'Kani', C: 'Kani', B: 'Kanię', N: 'Kanią' });
    // Vocative is an explicit, honest gap (G20: luki jawne).
    expect(paradigmOf('Kozera', 'f').W).toBeNull();
  });

  it('feminine indeclinable: non -a surname of a female bearer (G7/G9)', () => {
    expect(paradigmOf('Wilk', 'f')).toEqual({
      M: 'Wilk', D: 'Wilk', C: 'Wilk', B: 'Wilk', N: 'Wilk', Ms: 'Wilk', W: 'Wilk',
    });
    expect(paradigmOf('Zamek', 'f').N).toBe('Zamek');
    expect(paradigmOf('Kos', 'f').D).toBe('Kos');
    expect(paradigmOf('Mroczek', 'f').C).toBe('Mroczek');
  });
});

describe('generateSurnameParadigm — flags, never guesses (§2.1/§2.6)', () => {
  it('foreign orthography flags immediately', () => {
    expect(generateSurnameParadigm('Smith', 'm')).toEqual({ status: 'flaga', powod: 'obce' });
    expect(generateSurnameParadigm('Müller', 'm')).toEqual({ status: 'flaga', powod: 'obce' });
    expect(generateSurnameParadigm('Nguyen', 'm')).toEqual({ status: 'flaga', powod: 'obce' });
    expect(isForeignName('Kowalski')).toBe(false);
  });

  it('dictionary-only classes refuse to generate (movable -el/-ec, masc -a/-o, other adjectivals)', () => {
    for (const [lemma, klasa] of [
      ['Wróbel', 'noun-masculine-el'],
      ['Kozera', 'noun-masculine-a'],
      ['Matejko', 'noun-masculine-o'],
      ['Biegły', 'adjectival-other'],
    ]) {
      const out = generateSurnameParadigm(lemma, 'm');
      expect(out.status, lemma).toBe('flaga');
      expect(out.powod).toBe('nie-umiem-odmienić');
      expect(out.klasa).toBe(klasa);
    }
  });

  it('classStatus override degrades a rule class to dictionary-only (G-W1-5 hook)', () => {
    const out = generateSurnameParadigm('Baran', 'm', { classStatus: { 'noun-masculine': 'dictionary-only' } });
    expect(out.status).toBe('flaga');
  });

  it('promoting a generator-less class still flags — there is no rule to promote', () => {
    const out = generateSurnameParadigm('Wróbel', 'm', { classStatus: { 'noun-masculine-el': 'rule' } });
    expect(out.status).toBe('flaga');
    expect(out.klasa).toBe('noun-masculine-el');
  });

  it('degenerate input flags struktura', () => {
    expect(generateSurnameParadigm('K', 'm').powod).toBe('struktura');
    expect(generateSurnameParadigm(7, 'm').powod).toBe('struktura');
  });
});

describe('classifySurname / DEFAULT_CLASS_STATUS coherence', () => {
  it('every classifiable class has a declared status', () => {
    for (const [lemma, gender] of [
      ['Kowalski', 'm'], ['Kowalska', 'f'], ['Chmielny', 'm'], ['Chmielna', 'f'],
      ['Baran', 'm'], ['Pietraszek', 'm'], ['Wróbel', 'm'], ['Kozera', 'm'],
      ['Matejko', 'm'], ['Kozera', 'f'], ['Wilk', 'f'], ['Biegły', 'm'],
    ]) {
      const klasa = classifySurname(lemma, gender);
      expect(klasa, `${lemma}/${gender}`).not.toBeNull();
      expect(DEFAULT_CLASS_STATUS[klasa], klasa).toBeDefined();
    }
  });
});

describe('surnameLemmaCandidates — self-validating rule inversion (§2.2 pkt 3)', () => {
  it('recovers adjectival lemmas from oblique forms', () => {
    expect(surnameLemmaCandidates('Żurawskiego')).toContainEqual(
      { lemma: 'Żurawski', gender: 'm', klasa: 'adjectival-ski-m' },
    );
    expect(surnameLemmaCandidates('Zawadzkiej')).toContainEqual(
      { lemma: 'Zawadzka', gender: 'f', klasa: 'adjectival-ska-f' },
    );
  });

  it('recovers noun lemmas including the movable e', () => {
    expect(surnameLemmaCandidates('Barana').map((c) => c.lemma)).toContain('Baran');
    expect(surnameLemmaCandidates('Mroczka').map((c) => c.lemma)).toContain('Mroczek');
    expect(surnameLemmaCandidates('Baranie').map((c) => c.lemma)).toContain('Baran');
  });

  it('every candidate really regenerates the input form', () => {
    for (const form of ['Żurawskiego', 'Zawadzkiej', 'Barana', 'Mroczka', 'Wilkiem', 'Kozerze']) {
      for (const candidate of surnameLemmaCandidates(form)) {
        const regenerated = generateSurnameParadigm(candidate.lemma, candidate.gender);
        expect(Object.values(regenerated.paradygmat)).toContain(form);
      }
    }
  });

  it('returns nothing for un-invertible junk', () => {
    expect(surnameLemmaCandidates('xyz123')).toEqual([]);
  });
});

describe('genderFromAdjectivalSurname (§2.3 pkt 2, G13/G15 support)', () => {
  it('reads gender off adjectival forms and stays silent elsewhere', () => {
    expect(genderFromAdjectivalSurname('Żurawski')).toBe('m');
    expect(genderFromAdjectivalSurname('Żurawskiemu')).toBe('m');
    expect(genderFromAdjectivalSurname('Zawadzka')).toBe('f');
    expect(genderFromAdjectivalSurname('Zawadzkiej')).toBe('f');
    expect(genderFromAdjectivalSurname('Wilk')).toBeNull();
  });
});

describe('determinism (G-W2-3)', () => {
  it('double invocation is identical', () => {
    const a = generateSurnameParadigm('Pietraszek', 'm');
    const b = generateSurnameParadigm('Pietraszek', 'm');
    expect(a).toEqual(b);
    expect(CASES).toEqual(['M', 'D', 'C', 'B', 'N', 'Ms', 'W']);
  });
});
