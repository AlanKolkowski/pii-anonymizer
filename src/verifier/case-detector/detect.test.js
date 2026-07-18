// W3 (W1-W3-MORPHOLOGY-DESIGN.md SS3, FLEKSJA-IMPL-PLAN.md SS3.4): detectCase
// cascade — S-P (preposition), S-R (verb government), S-A (role apposition,
// via the SAME mini-fixture morph object generate.test.js/analyze-
// person.test.js use), S-T (case annotation, untrusted, never solely
// decisive at high confidence). Intersection algebra, never guesses:
// contradiction -> nieustalony, no signal at all -> nieustalony.
import { CASES } from '../morph/paradigms.js';
import { loadMorphData } from '../morph/load.js';
import { MINI_LEXICON } from '../morph/fixtures/mini-lexicon.js';
import { PREPOSITION_CASES } from './prepositions.js';
import { VERB_GOVERNMENT } from './verbs.js';
import { detectCase } from './detect.js';

const morph = loadMorphData(MINI_LEXICON);

describe('prepositions.js / verbs.js — data shape', () => {
  it('every governed case is a real case code', () => {
    for (const cases of Object.values(PREPOSITION_CASES)) {
      for (const c of cases) expect(CASES).toContain(c);
    }
    for (const c of Object.values(VERB_GOVERNMENT)) expect(CASES).toContain(c);
  });
});

describe('detectCase — S-P preposition signal', () => {
  it('a single-case preposition immediately before the token resolves confidently', () => {
    const r = detectCase({ contextBefore: 'Zobowiązanie dla ', contextAfter: ' jest bezsporne.' });
    expect(r).toMatchObject({ status: 'ok', cases: ['D'], confidence: 'wysoka' });
  });

  it('a multi-case preposition ("w") narrows but stays low-confidence alone', () => {
    const r = detectCase({ contextBefore: 'Mieszka w ', contextAfter: '.' });
    expect(r.status).toBe('ok');
    expect(r.cases.sort()).toEqual(['B', 'Ms']);
    expect(r.confidence).toBe('niska');
  });
});

describe('detectCase — S-R verb government signal', () => {
  it('a known governing verb form resolves the case even a couple of words back', () => {
    const r = detectCase({ contextBefore: 'Doręczono niezwłocznie ', contextAfter: ' odpis pisma.' });
    expect(r).toMatchObject({ status: 'ok', cases: ['C'], confidence: 'wysoka' });
  });
});

describe('detectCase — S-A role apposition signal (via the shared mini-fixture)', () => {
  it('a role word in a known case form votes for that case, isolated from S-P/S-R', () => {
    // "doręczył" (personal past tense) is deliberately absent from
    // verbs.js (only the impersonal "doręczono" is listed) so this
    // context carries no S-P/S-R signal at all — only S-A.
    const r = detectCase(
      { contextBefore: 'Sąd doręczył zawiadomienie powodowi ', contextAfter: ' wraz z uzasadnieniem.' },
      { morph },
    );
    expect(r).toMatchObject({ status: 'ok', cases: ['C'], confidence: 'wysoka' });
    expect(r.signals.some((s) => s.signal === 'S-A')).toBe(true);
  });

  it('without the morph dependency, S-A contributes nothing (no silent fallback)', () => {
    const r = detectCase({ contextBefore: 'Sąd doręczył zawiadomienie powodowi ', contextAfter: '.' });
    expect(r.status).toBe('nieustalony');
  });
});

describe('detectCase — S-T annotation (untrusted, decyzja 17)', () => {
  it('annotation alone, no corroborating signal, is at most niska', () => {
    const r = detectCase({ contextBefore: 'W dokumencie wskazano ', contextAfter: ' jako stronę.', annotation: 'B' });
    expect(r).toEqual({ status: 'ok', cases: ['B'], confidence: 'niska', signals: expect.any(Array) });
  });

  it('annotation agreeing with an independent signal raises confidence', () => {
    const r = detectCase({ contextBefore: 'Zobowiązanie dla ', contextAfter: '.', annotation: 'D' });
    expect(r).toMatchObject({ status: 'ok', cases: ['D'], confidence: 'wysoka' });
  });

  it('annotation contradicting an independent signal fails closed (never overridden silently)', () => {
    const r = detectCase({ contextBefore: 'Zobowiązanie dla ', contextAfter: '.', annotation: 'C' });
    expect(r.status).toBe('nieustalony');
  });
});

describe('detectCase — no signal / conflicting signals never guess', () => {
  it('no recognizable signal at all', () => {
    const r = detectCase({ contextBefore: 'Lorem ipsum ', contextAfter: ' dolor sit.' });
    expect(r.status).toBe('nieustalony');
  });

  it('genuinely conflicting non-annotation signals fail closed rather than picking one', () => {
    const r = detectCase({ contextBefore: 'wezwano dla ', contextAfter: '.' });
    expect(r.status).toBe('nieustalony');
  });

  it('empty context and no annotation', () => {
    expect(detectCase().status).toBe('nieustalony');
    expect(detectCase({}).status).toBe('nieustalony');
  });
});
