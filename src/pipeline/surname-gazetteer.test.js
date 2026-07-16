import gazetteer from './data/surname-gazetteer.json' with { type: 'json' };
import { findGazetteerEntities } from './surname-gazetteer.js';

function seg(text, offset = 0) {
  return [{ text, offset }];
}

function find(text, { entities = [], segments } = {}) {
  return findGazetteerEntities(text, segments ?? seg(text), entities);
}

function spans(text, opts) {
  return find(text, opts).map((e) => ({
    value: text.slice(e.start, e.end),
    review: e.forceTier === 'review',
  }));
}

describe('findGazetteerEntities — per-entry casing contract (§2.4, iterates the data)', () => {
  it('title-case emits (review without a slot), ALL-CAPS emits, lowercase never', () => {
    for (const entry of gazetteer.entries) {
      for (const form of entry.forms) {
        const mid = `Widziano wtedy ${form} obok budynku.`;
        const midCaps = `Widziano wtedy ${form.toLocaleUpperCase('pl')} obok budynku.`;
        const midLower = `Widziano wtedy ${form.toLocaleLowerCase('pl')} obok budynku.`;
        const expected = entry.slotOnly ? 0 : 1;
        expect(find(mid), `${form} title-case`).toHaveLength(expected);
        expect(find(midCaps), `${form} ALL-CAPS`).toHaveLength(expected);
        if (!entry.slotOnly) {
          expect(find(mid)[0].forceTier, `${form} slotless => review`).toBe('review');
          expect(find(mid)[0].source).toBe('gazetteer');
          expect(find(mid)[0].score).toBe(0.95);
        }
        expect(find(midLower), `${form} lowercase must stay silent`).toHaveLength(0);
      }
    }
  });

  it('slotOnly entries emit with a slot — as mask', () => {
    for (const entry of gazetteer.entries.filter((e) => e.slotOnly)) {
      const text = `Stawił się Jan ${entry.lemma} osobiście.`;
      const found = find(text);
      expect(found, entry.lemma).toHaveLength(1);
      expect(found[0].forceTier).toBeUndefined();
      expect(text.slice(found[0].start, found[0].end)).toBe(`Jan ${entry.lemma}`);
    }
  });
});

describe('findGazetteerEntities — slots S1-S5 (§2.2 pkt 6)', () => {
  it('S1: first name before — mask, span covers name and surname', () => {
    const text = 'Pozew złożyła Anna Wrona wczoraj.';
    expect(spans(text)).toEqual([{ value: 'Anna Wrona', review: false }]);
  });

  it('S1: first name after an ALL-CAPS surname (komparycja order)', () => {
    const text = 'Pozwana: WRONA Janina, zam. w Toruniu.';
    expect(spans(text)).toEqual([{ value: 'WRONA Janina', review: false }]);
  });

  it('S2: initial before — mask, span includes the initial', () => {
    const text = 'Pełnomocnik doręczył pismo J. Wronie osobiście.';
    expect(spans(text)).toEqual([{ value: 'J. Wronie', review: false }]);
  });

  it('S3: Pan/Pani title before — mask, surname-only span', () => {
    const text = 'Wezwano świadka Pana Kozła na rozprawę.';
    expect(spans(text)).toEqual([{ value: 'Kozła', review: false }]);
  });

  it('S3: adjacency to a detected PERSON_ROLE_OR_TITLE entity — mask', () => {
    const text = 'Zeznanie złożył świadek Dzięcioł przed sądem.';
    const role = {
      entity_group: 'PERSON_ROLE_OR_TITLE',
      start: text.indexOf('świadek'),
      end: text.indexOf('świadek') + 'świadek'.length,
      score: 0.95,
      source: 'lexicon',
    };
    expect(spans(text, { entities: [role] })).toEqual([{ value: 'Dzięcioł', review: false }]);
  });

  it('S4: procedural role before (role-lexicon nonEntity reuse) — mask', () => {
    const text = 'W odpowiedzi pozwany Kozioł wniósł o oddalenie.';
    expect(spans(text)).toEqual([{ value: 'Kozioł', review: false }]);
  });

  it('S4: role with a colon ("Pozwany: Wrona")', () => {
    const text = 'Oznaczono strony. Pozwany: Wrona Krzysztof.';
    // S1 fires too (first name after) — the wider span wins the slot check
    // order; either way the emission is mask-tier.
    const found = spans(text);
    expect(found).toHaveLength(1);
    expect(found[0].review).toBe(false);
    expect(['Wrona', 'Wrona Krzysztof']).toContain(found[0].value);
  });

  it('S5: function phrase before — mask', () => {
    const text = 'Sprawa toczy się przeciwko Sikorze o zapłatę.';
    expect(spans(text)).toEqual([{ value: 'Sikorze', review: false }]);
  });

  it('slots never cross a sentence boundary', () => {
    const first = 'Wniosek złożyła Anna.';
    const second = 'Wrona nie stawiła się.';
    const text = `${first} ${second}`;
    const segments = [
      { text: first, offset: 0 },
      { text: second, offset: first.length + 1 },
    ];
    // "Anna" ends the previous sentence; "Wrona" opens the next one — no S1,
    // and a sentence-start capital without a slot stays silent.
    expect(find(text, { segments })).toEqual([]);
  });
});

describe('findGazetteerEntities — silences (§2.2 pkt 5)', () => {
  it('sentence-start capital without a slot says nothing ("Wrona siedziała na płocie.")', () => {
    expect(find('Wrona siedziała na płocie.')).toEqual([]);
  });

  it('street-calendar collision stays silent ("ul. 3 Maja")', () => {
    expect(find('Biuro mieści się przy ul. 3 Maja 12 w Toruniu.')).toEqual([]);
  });

  it('lowercase noun usage never emits', () => {
    expect(find('Na płocie siedziała wrona, a obok przebiegł lis.')).toEqual([]);
  });

  it('a word containing a form as a substring does not match', () => {
    expect(find('Firma Wronka dostarczyła towar, a Lisowski podpisał.')).toEqual([]);
  });
});

describe('findGazetteerEntities — double-barrelled names (§2.2 pkt 5)', () => {
  it('extends the span over the hyphenated second part (also from outside the list)', () => {
    const text = 'Pozew wniosła Anna Wrona-Kowalska w maju.';
    expect(spans(text)).toEqual([{ value: 'Anna Wrona-Kowalska', review: false }]);
  });

  it('extends backward when the gazetteer form is the second part', () => {
    const text = 'Zeznania złożyła wtedy Kowalska-Wrona bez pełnomocnika.';
    expect(spans(text)).toEqual([{ value: 'Kowalska-Wrona', review: true }]);
  });

  it('emits one candidate when both parts are gazetteer forms', () => {
    const text = 'Umowę podpisała wtedy Wrona-Sikora bez zastrzeżeń.';
    const found = find(text);
    expect(found).toHaveLength(1);
    expect(text.slice(found[0].start, found[0].end)).toBe('Wrona-Sikora');
  });
});
