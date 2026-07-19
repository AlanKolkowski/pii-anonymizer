import {
  classifyEntityGroup,
  scanForPii,
  hasHardHit,
  assertTokensPresent,
  checkOutboundPayload,
  checkInboundPayload,
  validateToolResultShape,
} from './outbound-checks.mjs';

// MOST-IMPL-PLAN.md §3 M4 / §5, MCP-BRIDGE-DESIGN.md §6.3: the second,
// main-process layer of PII control, independent of the renderer. Fixture
// values below are reused verbatim from src/anonymizer.test.js (valid PESEL/
// IBAN/docket-number vectors already proven against the real checksum
// logic) rather than invented here, so a fixture typo can't silently defeat
// its own test.
const VALID_PESEL = '92071314764';
const VALID_EMAIL = 'biuro@nowak-wspolnicy.pl';
const VALID_IBAN = 'PL41-1140-2004-0000-9876-5432-1098';
const VALID_DOCKET = 'I C 1445/25';
const VALID_VIN = 'VF1BB05CF12345678';

describe('classifyEntityGroup (§5 hard/soft table)', () => {
  it.each([
    'PERSON_IDENTIFIER',
    'ORGANIZATION_IDENTIFIER',
    'BANK_ACCOUNT_IDENTIFIER',
    'EMAIL_ADDRESS',
    'PHONE_NUMBER',
  ])('classifies %s as hard', (group) => {
    expect(classifyEntityGroup(group)).toBe('hard');
  });

  it.each([
    'FINANCIAL_AMOUNT',
    'DOCUMENT_REFERENCE',
    'VEHICLE_IDENTIFIER',
    'LAND_REGISTER_IDENTIFIER',
  ])('classifies %s as soft', (group) => {
    expect(classifyEntityGroup(group)).toBe('soft');
  });

  it('defaults an unrecognized entity_group to hard (fail toward more scrutiny, not less)', () => {
    expect(classifyEntityGroup('SOME_FUTURE_GROUP')).toBe('hard');
  });
});

describe('scanForPii', () => {
  it('finds nothing in a properly tokenized payload', () => {
    const text = 'Klient [PERSON_NAME_1], PESEL [PERSON_IDENTIFIER_1], e-mail [EMAIL_ADDRESS_1].';
    expect(scanForPii(text)).toEqual([]);
  });

  it('flags a raw leaked PESEL as a hard hit with correct offsets', () => {
    const text = `Klient Jan Kowalski, PESEL ${VALID_PESEL}, mieszka w Toruniu.`;
    const hits = scanForPii(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].tier).toBe('hard');
    expect(hits[0].entity_group).toBe('PERSON_IDENTIFIER');
    expect(text.slice(hits[0].start, hits[0].end)).toBe(VALID_PESEL);
  });

  it('flags a raw leaked email as a hard hit', () => {
    const text = `Kontakt: ${VALID_EMAIL}`;
    const hits = scanForPii(text);
    expect(hits.some((h) => h.entity_group === 'EMAIL_ADDRESS' && h.tier === 'hard')).toBe(true);
  });

  it('flags a raw docket number as a soft hit (sygnatury are legitimately common in tokenized text)', () => {
    const text = `Sprawa prowadzona jest pod sygnaturą ${VALID_DOCKET} w tutejszym sądzie.`;
    const hits = scanForPii(text);
    expect(hits).toEqual([{ start: expect.any(Number), end: expect.any(Number), entity_group: 'DOCUMENT_REFERENCE', tier: 'soft' }]);
  });

  it('still finds a hard hit even when the rest of the document is already tokenized', () => {
    const text = `Pełnomocnik [PERSON_NAME_1] reprezentuje klienta. Kontakt do zespołu: ${VALID_EMAIL}.`;
    const hits = scanForPii(text);
    expect(hasHardHit(hits)).toBe(true);
  });

  it('returns hits sorted by start offset', () => {
    const text = `IBAN ${VALID_IBAN}, PESEL ${VALID_PESEL}.`;
    const hits = scanForPii(text);
    for (let i = 1; i < hits.length; i++) expect(hits[i].start).toBeGreaterThanOrEqual(hits[i - 1].start);
  });
});

describe('hasHardHit', () => {
  it('is false for an empty or all-soft hit list', () => {
    expect(hasHardHit([])).toBe(false);
    expect(hasHardHit([{ tier: 'soft' }])).toBe(false);
  });
  it('is true when any hit is hard', () => {
    expect(hasHardHit([{ tier: 'soft' }, { tier: 'hard' }])).toBe(true);
  });
});

describe('assertTokensPresent (W1 structural check)', () => {
  it('is true for text containing at least one token', () => {
    expect(assertTokensPresent('Witaj [PERSON_NAME_1].')).toBe(true);
  });
  it('is true for a case-annotated token (decyzja 17)', () => {
    expect(assertTokensPresent('Pismo doręczono dla [PERSON_NAME_1|D].')).toBe(true);
  });
  it('is false for plain prose with zero tokens', () => {
    expect(assertTokensPresent('Zwykły tekst bez żadnych nawiasów.')).toBe(false);
  });
});

describe('checkOutboundPayload (read_source / read_outcome / list_* direction)', () => {
  it('accepts a fully tokenized payload with zero hits', () => {
    expect(checkOutboundPayload('Klient [PERSON_NAME_1] mieszka w Toruniu.')).toEqual({ ok: true, hits: [] });
  });

  it('hard-blocks a payload with zero tokens (W1: not a heuristic)', () => {
    const result = checkOutboundPayload(`Klient Jan Kowalski, PESEL ${VALID_PESEL}.`);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-tokens');
  });

  it('WARNS (does not block) when a token is present but PII also leaked elsewhere in the same payload', () => {
    const text = `Pełnomocnik [PERSON_NAME_1]. Proszę o kontakt: ${VALID_EMAIL}.`;
    const result = checkOutboundPayload(text);
    expect(result.ok).toBe(true);
    expect(hasHardHit(result.hits)).toBe(true);
  });
});

describe('checkInboundPayload (write_outcome direction)', () => {
  it('is always ok, with or without tokens (assistant prose legitimately has none)', () => {
    expect(checkInboundPayload('Oto podsumowanie sprawy.')).toEqual({ ok: true, hits: [] });
  });

  it('surfaces a raw PESEL the client should not know, without blocking the write', () => {
    const result = checkInboundPayload(`Zgodnie z ustaleniami PESEL to ${VALID_PESEL}.`);
    expect(result.ok).toBe(true);
    expect(hasHardHit(result.hits)).toBe(true);
  });
});

describe('validateToolResultShape (§3 M4 result-shape validation)', () => {
  it('accepts the minimal valid shape', () => {
    expect(validateToolResultShape({ content: [{ type: 'text', text: 'x' }] })).toEqual({ ok: true });
  });

  it('accepts the shape with isError', () => {
    expect(validateToolResultShape({ content: [{ type: 'text', text: 'x' }], isError: true })).toEqual({ ok: true });
  });

  it.each([
    [null],
    [42],
    ['a string'],
    [{ content: [{ type: 'text', text: 'x' }], extra: 1 }],
    [{ content: [], }],
    [{ content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] }],
    [{ content: [{ type: 'text', text: 'x', extra: 1 }] }],
    [{ content: [{ type: 'json', text: 'x' }] }],
    [{ content: [{ type: 'text', text: 42 }] }],
    [{ content: [{ type: 'text', text: 'x' }], isError: 'yes' }],
  ])('rejects an invalid shape: %j', (bad) => {
    expect(validateToolResultShape(bad).ok).toBe(false);
  });
});
