import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveOccurrences, renderResolvedText, effectiveOutcomeLegend } from './substitution.js';
import { anonymizeText, deanonymizeText, deduplicateEntities } from './anonymizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_DIR = join(__dirname, '../test-data/synthetic');

function deanon(text, legend, opts = {}) {
  return renderResolvedText(resolveOccurrences(text, { legend, ...opts }), text);
}

// The synthetic fixtures' .expected.json start/end offsets don't align with
// the .txt files' actual (CRLF) content — a pre-existing fixture quirk,
// unrelated to S2: the real pipeline always detects entities fresh from
// whatever text is in front of it, so exact ground-truth offset alignment was
// never load-bearing anywhere except overlap-based eval scoring
// (src/eval/matching.js), which is tolerant of it. Re-locating each entity by
// its recorded text gives this golden test real document content and real
// entity values without depending on that offset drift.
function realignEntities(text, rawEntities) {
  const realigned = [];
  let cursor = 0;
  for (const e of rawEntities) {
    let idx = text.indexOf(e.text, cursor);
    if (idx === -1) idx = text.indexOf(e.text, 0);
    if (idx === -1) continue; // whitespace-variant entity text we can't locate — skip, don't fail the golden
    realigned.push({ entity_group: e.entity_group, start: idx, end: idx + e.text.length });
    cursor = idx + e.text.length;
  }
  return realigned;
}

describe('resolveOccurrences — resolution layers', () => {
  it('resolves to baseValue (legend) when no decision or resolver applies', () => {
    const occ = resolveOccurrences('[PERSON_NAME_1]', { legend: { '[PERSON_NAME_1]': 'Jan Kowalski' } });
    expect(occ).toEqual([{
      occurrenceIndex: 0,
      index: 0,
      token: '[PERSON_NAME_1]',
      tokenId: 'PERSON_NAME_1',
      type: 'PERSON_NAME',
      baseValue: 'Jan Kowalski',
      finalText: 'Jan Kowalski',
      source: 'baza',
    }]);
  });

  it('leaves an unresolved token (no legend entry) visible as itself', () => {
    const occ = resolveOccurrences('[PERSON_NAME_9]', { legend: {} });
    expect(occ[0].baseValue).toBeUndefined();
    expect(occ[0].finalText).toBe('[PERSON_NAME_9]');
    expect(occ[0].source).toBe('nierozwiązany');
  });

  it('a human decision wins over both the resolver and the base value', () => {
    const occ = resolveOccurrences('[PERSON_NAME_1]', {
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      decisions: { 0: 'Janowi Kowalskiemu' },
      resolveReplacement: () => ({ text: 'ignored resolver output' }),
    });
    expect(occ[0].finalText).toBe('Janowi Kowalskiemu');
    expect(occ[0].source).toBe('decyzja');
  });

  it('decisions may also be a Map keyed by occurrenceIndex', () => {
    const decisions = new Map([[0, 'Decyzja']]);
    const occ = resolveOccurrences('[PERSON_NAME_1]', {
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      decisions,
    });
    expect(occ[0].finalText).toBe('Decyzja');
  });

  it('the resolver wins over baseValue when no decision is present', () => {
    const occ = resolveOccurrences('[PERSON_NAME_1]', {
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      resolveReplacement: () => ({ text: 'Janowi Kowalskiemu' }),
    });
    expect(occ[0].finalText).toBe('Janowi Kowalskiemu');
    expect(occ[0].source).toBe('resolver');
  });

  it('falls back to baseValue when the resolver declines (returns undefined text)', () => {
    const occ = resolveOccurrences('[PERSON_NAME_1]', {
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      resolveReplacement: () => ({ text: undefined, note: 'nie umiem odmienić' }),
    });
    expect(occ[0].finalText).toBe('Jan Kowalski');
    expect(occ[0].source).toBe('baza');
  });

  it('never calls the resolver for a token with no legend entry', () => {
    let called = false;
    resolveOccurrences('[PERSON_NAME_9]', {
      legend: {},
      resolveReplacement: () => { called = true; return { text: 'should not happen' }; },
    });
    expect(called).toBe(false);
  });

  it('passes ±40-char tokenized-text context to the resolver', () => {
    let seen;
    resolveOccurrences('Zobowiązuje się [PERSON_NAME_1] do zapłaty kwoty.', {
      legend: { '[PERSON_NAME_1]': 'Jan Kowalski' },
      resolveReplacement: (ctx) => { seen = ctx; return { text: undefined }; },
    });
    expect(seen.contextBefore).toBe('Zobowiązuje się ');
    expect(seen.contextAfter).toBe(' do zapłaty kwoty.');
    expect(seen.baseValue).toBe('Jan Kowalski');
    expect(seen.occurrence).toBe(0);
  });

  it('numbers occurrenceIndex per match in left-to-right order, even for repeated tokens', () => {
    const occ = resolveOccurrences('[A_1] i [B_1] i [A_1]', { legend: {} });
    expect(occ.map((o) => o.occurrenceIndex)).toEqual([0, 1, 2]);
    expect(occ.map((o) => o.tokenId)).toEqual(['A_1', 'B_1', 'A_1']);
  });
});

describe('case-annotated tokens (decyzja 17) are fully consumed, never leak into output', () => {
  it('replaces the whole annotated span, including the case hint, with finalText', () => {
    expect(deanon('Doręczono [PERSON_NAME_1|C].', { '[PERSON_NAME_1]': 'Jan Kowalski' }))
      .toBe('Doręczono Jan Kowalski.');
  });

  it('resolveOccurrences keys the legend lookup by the canonical (unannotated) token', () => {
    const occ = resolveOccurrences('[PERSON_NAME_1|D]', { legend: { '[PERSON_NAME_1]': 'Jana Kowalskiego' } });
    expect(occ[0].tokenId).toBe('PERSON_NAME_1');
    expect(occ[0].token).toBe('[PERSON_NAME_1]');
    expect(occ[0].baseValue).toBe('Jana Kowalskiego');
    expect(occ[0].finalText).toBe('Jana Kowalskiego');
  });

  it('mixes annotated and plain tokens in the same text without misaligning offsets', () => {
    const text = '[PERSON_NAME_1|D] przekazał [PERSON_NAME_2] dokument.';
    const legend = { '[PERSON_NAME_1]': 'Jana Kowalskiego', '[PERSON_NAME_2]': 'Annie Nowak' };
    expect(deanon(text, legend)).toBe('Jana Kowalskiego przekazał Annie Nowak dokument.');
  });
});

describe('single-pass rendering: legend value is never re-scanned for tokens (S2 §4.4 pkt 2 / O-SF-4)', () => {
  it('does not cascade when a legend value literally contains another token', () => {
    // Deliberately pathological, hand-built legend — unreachable via normal
    // app usage because collectReservedTokens (anonymizer.js) reserves any
    // token literal already present in a source document, so a real,
    // freshly-generated token can never collide with text already sitting
    // inside another entry's value. The old sequential-replaceAll
    // deanonymizeText WOULD have cascaded here (each legend entry re-scanned
    // the whole accumulated result); the new engine intentionally does not.
    const text = 'X [A_1] Y';
    const legend = { '[A_1]': '[B_1]', '[B_1]': 'real value' };
    expect(deanon(text, legend)).toBe('X [B_1] Y');
  });
});

describe('$-pattern safety (goldens carried over from anonymizer.test.js)', () => {
  it('leaves $&, $$, $`, $\' in legend values verbatim — no replace-pattern interpolation', () => {
    expect(deanon('A [FINANCIAL_AMOUNT_1] B', { '[FINANCIAL_AMOUNT_1]': 'USD 100 $&' }))
      .toBe('A USD 100 $& B');
    expect(deanon('A [ORGANIZATION_NAME_1] B', { '[ORGANIZATION_NAME_1]': "Firma $' Sp. z o.o." }))
      .toBe("A Firma $' Sp. z o.o. B");
    expect(deanon('A [FINANCIAL_AMOUNT_1] B', { '[FINANCIAL_AMOUNT_1]': '$$ and $` end' }))
      .toBe('A $$ and $` end B');
  });
});

describe('deanonymizeText facade ≡ resolveOccurrences + renderResolvedText with an empty plan', () => {
  it('produces byte-identical output to calling the engine directly', () => {
    const text = 'Powód [PERSON_NAME_1] przeciwko [ORGANIZATION_NAME_1].';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski', '[ORGANIZATION_NAME_1]': 'ACME Sp. z o.o.' };
    expect(deanonymizeText(text, legend)).toBe(deanon(text, legend));
  });
});

describe('effectiveOutcomeLegend', () => {
  it('prefers the snapshot over the live legend when both exist', () => {
    const outcome = { legendSnapshot: { '[X_1]': 'snapshot' } };
    expect(effectiveOutcomeLegend(outcome, { '[X_1]': 'live' })).toEqual({ '[X_1]': 'snapshot' });
  });

  it('falls back to the live legend when there is no snapshot', () => {
    expect(effectiveOutcomeLegend({}, { '[X_1]': 'live' })).toEqual({ '[X_1]': 'live' });
  });

  it('falls back to an empty object when neither exists', () => {
    expect(effectiveOutcomeLegend(undefined, undefined)).toEqual({});
    expect(effectiveOutcomeLegend(null, null)).toEqual({});
  });
});

// Reference oracle mirroring the pre-refactor deanonymizeText body verbatim
// (sequential replaceAll, re-scanning the accumulating result after every
// legend entry) — kept only here, never in production, to prove the S2
// facade is byte-for-byte equivalent to it on realistic input (S2 §4.4's
// actual acceptance criterion). NOT a test of "recovers the pristine
// original": buildTokenMap deliberately collapses declined forms of the same
// person onto one token (see anonymizer.test.js "buildTokenMap with Polish
// declension"), so a document repeating a name in multiple grammatical cases
// never round-trips back to its exact original text — that limitation is
// pre-existing and orthogonal to S1/S2.
function oldDeanonymizeText(text, legend) {
  let result = text;
  for (const [token, value] of Object.entries(legend)) {
    result = result.replaceAll(token, () => value);
  }
  return result;
}

describe('S2 golden: old deanonymizeText ≡ new, byte-for-byte, on the synthetic corpus', () => {
  const docs = [
    'pismo_01_wezwanie_do_zaplaty',
    'pismo_02_umowa_najmu',
    'pismo_03_odwolanie_od_decyzji_zus',
    'pismo_04_umowa_o_dzielo',
    'pismo_05_wypowiedzenie_umowy_o_prace',
    'pismo_06_reklamacja_konsumencka',
    'pismo_07_emoji_astral',
  ];

  for (const doc of docs) {
    it(`matches the old sequential-replaceAll deanonymizeText exactly on ${doc}`, () => {
      const text = readFileSync(join(SYNTHETIC_DIR, `${doc}.txt`), 'utf8');
      const rawEntities = JSON.parse(readFileSync(join(SYNTHETIC_DIR, `${doc}.expected.json`), 'utf8'));
      const entities = deduplicateEntities(realignEntities(text, rawEntities));
      expect(entities.length).toBeGreaterThan(0);

      const { anonymized, legend } = anonymizeText(text, entities);
      const oldResult = oldDeanonymizeText(anonymized, legend);
      expect(deanonymizeText(anonymized, legend)).toBe(oldResult);
      // Directly through the S2 engine too, not only the facade.
      expect(renderResolvedText(resolveOccurrences(anonymized, { legend }), anonymized)).toBe(oldResult);
    });
  }

  it('pismo_07 (few, non-repeating entities) recovers its pristine original exactly', () => {
    const doc = 'pismo_07_emoji_astral';
    const text = readFileSync(join(SYNTHETIC_DIR, `${doc}.txt`), 'utf8');
    const rawEntities = JSON.parse(readFileSync(join(SYNTHETIC_DIR, `${doc}.expected.json`), 'utf8'));
    const entities = deduplicateEntities(realignEntities(text, rawEntities));

    const { anonymized, legend } = anonymizeText(text, entities);
    expect(deanonymizeText(anonymized, legend)).toBe(text);
  });
});
