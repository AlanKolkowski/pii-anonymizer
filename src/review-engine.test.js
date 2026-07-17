import {
  valueKeyFor,
  entityValueKey,
  parseValueKey,
  groupCandidates,
  pendingValueKeys,
  reviewComplete,
  applyMaskDecision,
  applyDecision,
  clearDecision,
  finishReview,
  emptyDictionary,
  parseDictionary,
  serializeDictionary,
  dictionaryDecisionFor,
  addDictionaryEntry,
  removeDictionaryEntry,
  dictionaryEntries,
  resolveClassifyResult,
} from './review-engine.js';
import { buildTokenMapMulti, applyTokens } from './anonymizer.js';
import { backfillOccurrencesStep } from './pipeline/steps/backfill.js';

function candidateAt(text, value, entity_group, from = 0, extra = {}) {
  const start = text.indexOf(value, from);
  if (start === -1) throw new Error(`value not found in text: ${value}`);
  return {
    entity_group,
    start,
    end: start + value.length,
    score: 0.9,
    source: 'test-model',
    tier: 'review',
    valueKey: valueKeyFor(entity_group, value),
    ...extra,
  };
}

function entityAt(text, value, entity_group, from = 0) {
  const start = text.indexOf(value, from);
  if (start === -1) throw new Error(`value not found in text: ${value}`);
  return { entity_group, start, end: start + value.length, score: 0.99, source: 'test-model' };
}

function assertNonOverlapping(entities) {
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
  }
}

const postEditBackfill = (text, entities) => backfillOccurrencesStep({ text, entities }).entities;

describe('valueKeyFor / entityValueKey / parseValueKey', () => {
  it('folds case, whitespace and NFC into one key', () => {
    expect(valueKeyFor('PERSON_ATTRIBUTE', 'WDOWIEC')).toBe('PERSON_ATTRIBUTE::wdowiec');
    expect(valueKeyFor('PERSON_ATTRIBUTE', '  wdowiec ')).toBe('PERSON_ATTRIBUTE::wdowiec');
    expect(valueKeyFor('HEALTH_DATA', 'nagły  zawał\nserca')).toBe('HEALTH_DATA::nagły zawał serca');
    expect(valueKeyFor('PERSON_NAME', 'Świadek')).toBe(valueKeyFor('PERSON_NAME', 'Świadek'));
  });

  it('entityValueKey slices the value from text', () => {
    const text = 'Jan jest Wdowiec.';
    const entity = entityAt(text, 'Wdowiec', 'PERSON_ATTRIBUTE');
    expect(entityValueKey(entity, text)).toBe('PERSON_ATTRIBUTE::wdowiec');
  });

  it('parseValueKey splits on the first :: only', () => {
    expect(parseValueKey('FINANCIAL_AMOUNT::10::20')).toEqual({ type: 'FINANCIAL_AMOUNT', folded: '10::20' });
  });
});

describe('groupCandidates / pendingValueKeys / reviewComplete', () => {
  const text = 'Wdowiec pisze. Znów wdowiec. Kwota 500 zł.';
  const candidates = [
    candidateAt(text, 'Wdowiec', 'PERSON_ATTRIBUTE'),
    candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE'),
    candidateAt(text, '500 zł', 'FINANCIAL_AMOUNT'),
  ];

  it('groups occurrences under one folded valueKey in first-seen order', () => {
    const groups = groupCandidates(candidates, text);
    expect([...groups.keys()]).toEqual(['PERSON_ATTRIBUTE::wdowiec', 'FINANCIAL_AMOUNT::500 zł']);
    expect(groups.get('PERSON_ATTRIBUTE::wdowiec').occurrences).toHaveLength(2);
    expect(groups.get('PERSON_ATTRIBUTE::wdowiec').entity_group).toBe('PERSON_ATTRIBUTE');
  });

  it('falls back to computing the key when a candidate has no valueKey field', () => {
    const bare = { entity_group: 'PERSON_ATTRIBUTE', start: 0, end: 7, score: 0.9, source: 'x' };
    const groups = groupCandidates([bare], text);
    expect([...groups.keys()]).toEqual(['PERSON_ATTRIBUTE::wdowiec']);
  });

  it('a document without candidates is review-complete by definition', () => {
    expect(reviewComplete([], new Map())).toBe(true);
    expect(reviewComplete(null, new Map())).toBe(true);
  });

  it('pending until every valueKey has a decision', () => {
    const decisions = new Map();
    expect(reviewComplete(candidates, decisions, text)).toBe(false);
    expect(pendingValueKeys(candidates, decisions, text)).toEqual([
      'PERSON_ATTRIBUTE::wdowiec',
      'FINANCIAL_AMOUNT::500 zł',
    ]);
    decisions.set('PERSON_ATTRIBUTE::wdowiec', { decision: 'mask', origin: 'user' });
    expect(reviewComplete(candidates, decisions, text)).toBe(false);
    decisions.set('FINANCIAL_AMOUNT::500 zł', { decision: 'skip', origin: 'user' });
    expect(reviewComplete(candidates, decisions, text)).toBe(true);
  });
});

describe('applyMaskDecision', () => {
  it('adds free occurrences whole, preserving span, type, score and source', () => {
    const text = 'Jan jest wdowiec od maja.';
    const occurrence = candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE');
    const { entities, appliedPositions } = applyMaskDecision({
      text, entities: [], occurrences: [occurrence], valueKey: occurrence.valueKey,
    });
    expect(entities).toEqual([{
      entity_group: 'PERSON_ATTRIBUTE',
      start: occurrence.start,
      end: occurrence.end,
      score: 0.9,
      source: 'test-model',
    }]);
    expect(appliedPositions).toEqual([`${occurrence.start}:${occurrence.end}`]);
  });

  it('masks only the uncovered remainders of a partially covered occurrence', () => {
    const text = 'leczony przez dr Jana Kowalskiego na oddziale';
    const maskEntity = entityAt(text, 'Jana Kowalskiego', 'PERSON_NAME');
    const occurrence = candidateAt(text, 'leczony przez dr Jana Kowalskiego na oddziale', 'HEALTH_DATA');
    const { entities } = applyMaskDecision({
      text, entities: [maskEntity], occurrences: [occurrence], valueKey: occurrence.valueKey,
    });
    assertNonOverlapping(entities);
    const added = entities.filter((e) => e !== maskEntity);
    expect(added.map((e) => text.slice(e.start, e.end))).toEqual(['leczony przez dr', 'na oddziale']);
    expect(added.every((e) => e.entity_group === 'HEALTH_DATA')).toBe(true);
    // Every visible character of the candidate is now inside some entity.
    for (let pos = occurrence.start; pos < occurrence.end; pos++) {
      if (/\s/.test(text[pos])) continue;
      expect(entities.some((e) => e.start <= pos && pos < e.end)).toBe(true);
    }
  });

  it('drops sub-minimum fragments instead of emitting one-character tokens', () => {
    const text = 'ab X cd';
    const maskEntity = entityAt(text, 'X', 'PERSON_NAME');
    // Occurrence "b X c": remainders "b" and "c" are below MIN_FRAGMENT_LENGTH.
    const occurrence = {
      entity_group: 'PERSON_ATTRIBUTE', start: 1, end: 6, score: 0.9, source: 't',
      valueKey: valueKeyFor('PERSON_ATTRIBUTE', text.slice(1, 6)),
    };
    const { entities } = applyMaskDecision({
      text, entities: [maskEntity], occurrences: [occurrence], valueKey: occurrence.valueKey,
    });
    expect(entities).toEqual([maskEntity]);
  });

  it('attributes postEdit backfill additions to the decision', () => {
    const text = 'Raz wdowiec. Dwa wdowiec. Trzy wdowiec.';
    const occurrences = [
      candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE'),
      candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE', 10),
    ];
    const { entities, appliedPositions } = applyMaskDecision({
      text, entities: [], occurrences, valueKey: occurrences[0].valueKey, postEdit: postEditBackfill,
    });
    // Third occurrence seeded by backfill even though no candidate covered it.
    expect(entities).toHaveLength(3);
    expect(entities.map((e) => text.slice(e.start, e.end))).toEqual(['wdowiec', 'wdowiec', 'wdowiec']);
    // All three are new (entities started empty) — appliedPositions is keyed
    // by position (start:end), not value, so undo can tell exactly which
    // entities THIS application added (see review-engine.js module comment).
    expect(appliedPositions).toEqual(entities.map((e) => `${e.start}:${e.end}`));
    assertNonOverlapping(entities);
  });
});

describe('applyDecision / clearDecision — golden flow', () => {
  const text = 'Powód jest wdowiec. Świadek zeznał: wdowiec.';
  const candidates = [
    candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE'),
    candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE', 20),
  ];
  const valueKey = 'PERSON_ATTRIBUTE::wdowiec';

  it('mask → all occurrences tokenized, one legend entry; undo → visible again', () => {
    const masked = applyDecision({
      text, entities: [], candidates, decisions: new Map(), valueKey, decision: 'mask', postEdit: postEditBackfill,
    });
    expect(masked.decisions.get(valueKey)).toMatchObject({ decision: 'mask', origin: 'user' });
    expect(masked.entities).toHaveLength(2);

    const { seen, legend } = buildTokenMapMulti([{ text, entities: masked.entities }]);
    const anonymized = applyTokens(text, masked.entities, seen);
    expect(anonymized).toBe('Powód jest [PERSON_ATTRIBUTE_1]. Świadek zeznał: [PERSON_ATTRIBUTE_1].');
    expect(legend['[PERSON_ATTRIBUTE_1]']).toBe('wdowiec');

    const undone = clearDecision({ text, entities: masked.entities, decisions: masked.decisions, valueKey });
    expect(undone.entities).toEqual([]);
    expect(undone.decisions.has(valueKey)).toBe(false);
    expect(reviewComplete(candidates, undone.decisions, text)).toBe(false);
  });

  it('skip leaves entities untouched (same reference) and records the origin', () => {
    const existing = [entityAt(text, 'Powód', 'PERSON_ROLE_OR_TITLE')];
    const skipped = applyDecision({
      text, entities: existing, candidates, decisions: new Map(), valueKey, decision: 'skip', origin: 'bulk',
    });
    expect(skipped.entities).toBe(existing);
    expect(skipped.decisions.get(valueKey)).toEqual({ decision: 'skip', origin: 'bulk' });
  });

  it('flipping mask → skip removes the applied entities, including backfilled copies', () => {
    const masked = applyDecision({
      text, entities: [], candidates: [candidates[0]], decisions: new Map(), valueKey, decision: 'mask', postEdit: postEditBackfill,
    });
    // Backfill seeded the second occurrence from the single candidate.
    expect(masked.entities).toHaveLength(2);
    const flipped = applyDecision({
      text, entities: masked.entities, candidates: [candidates[0]], decisions: masked.decisions, valueKey, decision: 'skip',
    });
    expect(flipped.entities).toEqual([]);
    expect(flipped.decisions.get(valueKey)).toMatchObject({ decision: 'skip' });
  });

  it('re-masking does not stack duplicate entities', () => {
    const once = applyDecision({
      text, entities: [], candidates, decisions: new Map(), valueKey, decision: 'mask',
    });
    const twice = applyDecision({
      text, entities: once.entities, candidates, decisions: once.decisions, valueKey, decision: 'mask',
    });
    expect(twice.entities).toHaveLength(2);
    assertNonOverlapping(twice.entities);
  });

  it('does not touch entities of other values on undo', () => {
    const other = entityAt(text, 'Świadek', 'PERSON_ROLE_OR_TITLE');
    const masked = applyDecision({
      text, entities: [other], candidates, decisions: new Map(), valueKey, decision: 'mask',
    });
    const undone = clearDecision({ text, entities: masked.entities, decisions: masked.decisions, valueKey });
    expect(undone.entities).toEqual([other]);
  });

  // Regression for the W1 MCP leak (SCOPE-TIERS-DESIGN.md §4.3 pkt 1: "cofnięcie
  // przywraca stan"). The test above passes even on the broken code because it
  // never supplies `postEdit` — without a backfill pass, applyMaskDecision can
  // never add an entity of a value it wasn't explicitly asked about, so the
  // old value-keyed appliedKeys accidentally lines up with the position-keyed
  // intent. Production ALWAYS supplies postEdit (main.js:1218, reviewPostEdit
  // = backfillOccurrencesStep with no tierOf) — this is what actually runs.
  //
  // Scenario: "Jan Kowalski" already exists as its own, decision-independent
  // entity (e.g. an unconditionally-masked W1 mention). A second, unrelated
  // decision (masking "5000 zł") triggers postEdit, which — because it scans
  // the WHOLE document for known values, not just the decided one — discovers
  // a second, previously-uncovered "Jan Kowalski" (standing in for the hole
  // tierPartitionStep leaves when it pulls a blocking W2 span, e.g. a
  // "Prezes Zarządu Jan Kowalski" role mention, out of ctx.entities) and seeds
  // it too. The amount decision's applied set must capture ONLY what IT
  // added — the amount plus the seeded duplicate — never the pre-existing,
  // decision-independent "Jan Kowalski".
  it('does not remove a pre-existing entity merely because postEdit backfills a same-valued duplicate elsewhere', () => {
    const crossText = 'Jan Kowalski zawarł umowę. Pozwana zapłaci 5000 zł. Podpisał Jan Kowalski.';
    const preExisting = entityAt(crossText, 'Jan Kowalski', 'PERSON_NAME');
    const amountCandidate = candidateAt(crossText, '5000 zł', 'FINANCIAL_AMOUNT');
    const amountKey = amountCandidate.valueKey;

    const masked = applyDecision({
      text: crossText,
      entities: [preExisting],
      candidates: [amountCandidate],
      decisions: new Map(),
      valueKey: amountKey,
      decision: 'mask',
      postEdit: postEditBackfill,
    });
    // Sanity check on the reproduction itself: postEdit really did seed a
    // second, distinct "Jan Kowalski" entity (not just re-find the first).
    expect(masked.entities).toHaveLength(3);
    const secondJanKowalski = masked.entities.find(
      (e) => e !== preExisting && e.entity_group === 'PERSON_NAME',
    );
    expect(secondJanKowalski).toBeDefined();
    expect(crossText.slice(secondJanKowalski.start, secondJanKowalski.end)).toBe('Jan Kowalski');

    // Radca rozmyśla się: flips the SAME amount decision to 'skip'. Only the
    // amount and the seeded duplicate were caused by that decision; the
    // pre-existing "Jan Kowalski" predates it and must survive untouched.
    const flipped = applyDecision({
      text: crossText,
      entities: masked.entities,
      candidates: [amountCandidate],
      decisions: masked.decisions,
      valueKey: amountKey,
      decision: 'skip',
    });
    expect(flipped.entities).toEqual([preExisting]);

    // Step D (SCOPE-TIERS-DESIGN.md audit): clearDecision shares
    // removeAppliedEntities with applyDecision's mask→skip flip above, so it
    // must hold the same invariant from the same contaminated-looking state —
    // not just "undo" in the abstract, but the concrete `masked` produced by
    // this exact postEdit-tainted application.
    const cleared = clearDecision({
      text: crossText, entities: masked.entities, decisions: masked.decisions, valueKey: amountKey,
    });
    expect(cleared.entities).toEqual([preExisting]);
  });
});

describe('finishReview', () => {
  it('resolves every pending value as skip with origin bulk, decided ones untouched', () => {
    const text = 'Wdowiec winien 500 zł i 700 zł.';
    const candidates = [
      candidateAt(text, 'Wdowiec', 'PERSON_ATTRIBUTE'),
      candidateAt(text, '500 zł', 'FINANCIAL_AMOUNT'),
      candidateAt(text, '700 zł', 'FINANCIAL_AMOUNT'),
    ];
    const decisions = new Map([['PERSON_ATTRIBUTE::wdowiec', { decision: 'mask', origin: 'user' }]]);
    const finished = finishReview(candidates, decisions, text);
    expect(finished.get('PERSON_ATTRIBUTE::wdowiec')).toEqual({ decision: 'mask', origin: 'user' });
    expect(finished.get('FINANCIAL_AMOUNT::500 zł')).toEqual({ decision: 'skip', origin: 'bulk' });
    expect(finished.get('FINANCIAL_AMOUNT::700 zł')).toEqual({ decision: 'skip', origin: 'bulk' });
    expect(reviewComplete(candidates, finished, text)).toBe(true);
    expect(decisions.size).toBe(1);
  });
});

describe('dictionary', () => {
  it('parses corrupt or foreign input to an empty dictionary', () => {
    expect(parseDictionary(null)).toEqual(emptyDictionary());
    expect(parseDictionary('')).toEqual(emptyDictionary());
    expect(parseDictionary('{nope')).toEqual(emptyDictionary());
    expect(parseDictionary('"string"')).toEqual(emptyDictionary());
    expect(parseDictionary('{"alwaysMask": {"T": "not-a-list"}, "alwaysSkip": 7}')).toEqual(emptyDictionary());
  });

  it('folds stored values on read, so hand-edited entries still match', () => {
    const dict = parseDictionary('{"alwaysSkip": {"PERSON_ATTRIBUTE": ["  WDOWIEC "]}}');
    expect(dictionaryDecisionFor(dict, 'PERSON_ATTRIBUTE::wdowiec')).toBe('skip');
  });

  it('add/remove round-trips through serialization', () => {
    let dict = emptyDictionary();
    dict = addDictionaryEntry(dict, 'PERSON_ATTRIBUTE::wdowiec', 'skip');
    dict = addDictionaryEntry(dict, 'HEALTH_DATA::cukrzyca', 'mask');
    const revived = parseDictionary(serializeDictionary(dict));
    expect(dictionaryDecisionFor(revived, 'PERSON_ATTRIBUTE::wdowiec')).toBe('skip');
    expect(dictionaryDecisionFor(revived, 'HEALTH_DATA::cukrzyca')).toBe('mask');
    expect(dictionaryDecisionFor(revived, 'HEALTH_DATA::wdowiec')).toBe(null);

    const removed = removeDictionaryEntry(revived, 'PERSON_ATTRIBUTE::wdowiec');
    expect(dictionaryDecisionFor(removed, 'PERSON_ATTRIBUTE::wdowiec')).toBe(null);
    expect(dictionaryDecisionFor(removed, 'HEALTH_DATA::cukrzyca')).toBe('mask');
  });

  it('a value is never on both sides — adding flips the side', () => {
    let dict = addDictionaryEntry(emptyDictionary(), 'PERSON_ATTRIBUTE::wdowiec', 'skip');
    dict = addDictionaryEntry(dict, 'PERSON_ATTRIBUTE::wdowiec', 'mask');
    expect(dictionaryDecisionFor(dict, 'PERSON_ATTRIBUTE::wdowiec')).toBe('mask');
    expect(dictionaryEntries(dict)).toEqual([
      { valueKey: 'PERSON_ATTRIBUTE::wdowiec', type: 'PERSON_ATTRIBUTE', folded: 'wdowiec', decision: 'mask' },
    ]);
  });

  it('does not mutate its input', () => {
    const dict = emptyDictionary();
    addDictionaryEntry(dict, 'PERSON_ATTRIBUTE::wdowiec', 'mask');
    expect(dict).toEqual(emptyDictionary());
  });
});

describe('resolveClassifyResult', () => {
  const text = 'Jan Kowalski, wdowiec, winien 500 zł.';

  it('no candidates → entities pass through by reference, decisions survive', () => {
    const entities = [entityAt(text, 'Jan Kowalski', 'PERSON_NAME')];
    const prevDecisions = new Map([['PERSON_ATTRIBUTE::wdowiec', { decision: 'skip', origin: 'user' }]]);
    const result = resolveClassifyResult({
      text, entities, candidates: [], prevDecisions, dictionary: emptyDictionary(),
    });
    expect(result.entities).toBe(entities);
    expect(result.candidates).toEqual([]);
    expect(result.decisions.get('PERSON_ATTRIBUTE::wdowiec')).toEqual({ decision: 'skip', origin: 'user' });
    expect(result.decisions).not.toBe(prevDecisions);
  });

  it('dictionary resolves fresh candidates with origin dictionary — mask side masks', () => {
    const entities = [entityAt(text, 'Jan Kowalski', 'PERSON_NAME')];
    const candidates = [
      candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE'),
      candidateAt(text, '500 zł', 'FINANCIAL_AMOUNT'),
    ];
    const dictionary = addDictionaryEntry(emptyDictionary(), 'PERSON_ATTRIBUTE::wdowiec', 'mask');
    const result = resolveClassifyResult({
      text, entities, candidates, prevDecisions: new Map(), dictionary, postEdit: postEditBackfill,
    });
    expect(result.decisions.get('PERSON_ATTRIBUTE::wdowiec')).toMatchObject({ decision: 'mask', origin: 'dictionary' });
    expect(result.entities.some((e) => text.slice(e.start, e.end) === 'wdowiec')).toBe(true);
    // Undecided candidate stays pending; entities untouched for it.
    expect(result.decisions.has('FINANCIAL_AMOUNT::500 zł')).toBe(false);
    expect(reviewComplete(result.candidates, result.decisions, text)).toBe(false);
  });

  it('dictionary skip resolves without masking', () => {
    const candidates = [candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE')];
    const dictionary = addDictionaryEntry(emptyDictionary(), 'PERSON_ATTRIBUTE::wdowiec', 'skip');
    const result = resolveClassifyResult({
      text, entities: [], candidates, prevDecisions: new Map(), dictionary,
    });
    expect(result.entities).toEqual([]);
    expect(result.decisions.get('PERSON_ATTRIBUTE::wdowiec')).toEqual({ decision: 'skip', origin: 'dictionary' });
    expect(reviewComplete(result.candidates, result.decisions, text)).toBe(true);
  });

  it('a document decision wins over the dictionary', () => {
    const candidates = [candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE')];
    const dictionary = addDictionaryEntry(emptyDictionary(), 'PERSON_ATTRIBUTE::wdowiec', 'mask');
    const prevDecisions = new Map([['PERSON_ATTRIBUTE::wdowiec', { decision: 'skip', origin: 'user' }]]);
    const result = resolveClassifyResult({
      text, entities: [], candidates, prevDecisions, dictionary,
    });
    expect(result.entities).toEqual([]);
    expect(result.decisions.get('PERSON_ATTRIBUTE::wdowiec')).toEqual({ decision: 'skip', origin: 'user' });
  });

  it('re-applies surviving mask decisions to the fresh entity list after a rerun', () => {
    const candidates = [candidateAt(text, 'wdowiec', 'PERSON_ATTRIBUTE')];
    const prevDecisions = new Map([
      ['PERSON_ATTRIBUTE::wdowiec', {
        decision: 'mask', origin: 'user', appliedPositions: [`${candidates[0].start}:${candidates[0].end}`],
      }],
    ]);
    const freshEntities = [entityAt(text, 'Jan Kowalski', 'PERSON_NAME')];
    const result = resolveClassifyResult({
      text, entities: freshEntities, candidates, prevDecisions, dictionary: emptyDictionary(),
    });
    expect(result.entities).toHaveLength(2);
    expect(result.entities.some((e) => text.slice(e.start, e.end) === 'wdowiec')).toBe(true);
    expect(result.decisions.get('PERSON_ATTRIBUTE::wdowiec')).toMatchObject({ decision: 'mask', origin: 'user' });
    expect(reviewComplete(result.candidates, result.decisions, text)).toBe(true);
    assertNonOverlapping(result.entities);
  });

  it('stale decisions (valueKey no longer among candidates) stay dormant and harmless', () => {
    const candidates = [candidateAt(text, '500 zł', 'FINANCIAL_AMOUNT')];
    // Position is a placeholder — irrelevant here, since this valueKey has no
    // matching candidate and is therefore never re-applied by the loop below.
    const prevDecisions = new Map([
      ['PERSON_ATTRIBUTE::rozwodnik', { decision: 'mask', origin: 'user', appliedPositions: ['0:9'] }],
    ]);
    const result = resolveClassifyResult({
      text, entities: [], candidates, prevDecisions, dictionary: emptyDictionary(),
    });
    expect(result.entities).toEqual([]);
    expect(result.decisions.get('PERSON_ATTRIBUTE::rozwodnik')).toBeDefined();
    expect(pendingValueKeys(result.candidates, result.decisions, text)).toEqual(['FINANCIAL_AMOUNT::500 zł']);
  });
});
