import { describe, it, expect } from 'vitest';
import { containsToken, findTokens, splitTokenParts, isTokenLiteral, tokenType } from './tokens.js';
import { allEntityTypes } from './pipeline/configs/entity-sources.js';

describe('tokens grammar — corpus of real entity types', () => {
  const types = allEntityTypes();

  it('round-trips every real entity type as [TYPE_n]', () => {
    expect(types.length).toBeGreaterThan(10);
    for (const type of types) {
      const token = `[${type}_1]`;
      expect(containsToken(token)).toBe(true);
      expect(isTokenLiteral(token)).toBe(true);
      expect(findTokens(token)).toEqual([{ token, tokenId: `${type}_1`, type, index: 0 }]);
      expect(tokenType(`${type}_1`)).toBe(type);
      expect(splitTokenParts(token)).toEqual([{ token, tokenId: `${type}_1`, type }]);
    }
  });

  it('round-trips every real entity type embedded in surrounding prose', () => {
    for (const type of types) {
      const text = `Powód [${type}_3] wnosi o.`;
      const found = findTokens(text);
      expect(found).toHaveLength(1);
      expect(found[0].tokenId).toBe(`${type}_3`);
      expect(found[0].type).toBe(type);
    }
  });
});

describe('literalność / domknięcie ]', () => {
  it('[TYPE_1] does not match inside [TYPE_10]', () => {
    const found = findTokens('[PERSON_NAME_10]');
    expect(found).toHaveLength(1);
    expect(found[0].tokenId).toBe('PERSON_NAME_10');
  });

  it('two tokens differing only by a trailing digit stay distinct', () => {
    const found = findTokens('[PERSON_NAME_1] i [PERSON_NAME_10]');
    expect(found.map((t) => t.tokenId)).toEqual(['PERSON_NAME_1', 'PERSON_NAME_10']);
  });
});

describe('nieprzenikalność sentinela U+FFFC', () => {
  it('does not match a token literal with the sentinel injected inside it', () => {
    const withSentinel = '[PERSON￼_NAME_1]';
    expect(containsToken(withSentinel)).toBe(false);
    expect(findTokens(withSentinel)).toEqual([]);
    expect(isTokenLiteral(withSentinel)).toBe(false);
  });
});

describe('edge-case literals', () => {
  it('rejects a lowercase type', () => {
    expect(containsToken('[lowercase_1]')).toBe(false);
  });

  it('rejects a missing index', () => {
    expect(containsToken('[TYPE_]')).toBe(false);
  });

  it('rejects a missing underscore before the index', () => {
    expect(containsToken('[TYPE1]')).toBe(false);
  });

  it('matches only the inner token when brackets are doubled', () => {
    const found = findTokens('[[TYPE_1]]');
    expect(found).toEqual([{ token: '[TYPE_1]', tokenId: 'TYPE_1', type: 'TYPE', index: 1 }]);
  });

  it('matches a token at the very start of text', () => {
    expect(findTokens('[TYPE_1] koniec')[0].index).toBe(0);
  });

  it('matches a token at the very end of text', () => {
    const text = 'początek [TYPE_1]';
    expect(findTokens(text)[0].index).toBe(text.length - '[TYPE_1]'.length);
  });

  it('matches two tokens stuck together with no separator', () => {
    const found = findTokens('[TYPE_1][OTHER_2]');
    expect(found.map((t) => t.tokenId)).toEqual(['TYPE_1', 'OTHER_2']);
  });
});

describe('case annotation (decyzja 17)', () => {
  it('parses each of the seven valid case codes', () => {
    for (const code of ['M', 'D', 'C', 'B', 'N', 'Ms', 'W']) {
      const found = findTokens(`[PERSON_NAME_1|${code}]`);
      expect(found).toHaveLength(1);
      expect(found[0].tokenId).toBe('PERSON_NAME_1');
      expect(found[0].case).toBe(code);
      expect(found[0].token).toBe('[PERSON_NAME_1]');
    }
  });

  it('treats an absent annotation as case being genuinely absent, not undefined-valued', () => {
    const [entry] = findTokens('[PERSON_NAME_1]');
    expect('case' in entry).toBe(false);
  });

  it('rejects an invalid case code — the whole bracketed span falls back to plain text', () => {
    const text = '[PERSON_NAME_1|X]';
    expect(containsToken(text)).toBe(false);
    expect(findTokens(text)).toEqual([]);
    expect(splitTokenParts(text)).toEqual([{ text }]);
    expect(isTokenLiteral(text)).toBe(false);
  });

  it('rejects an empty annotation', () => {
    expect(containsToken('[PERSON_NAME_1|]')).toBe(false);
  });

  it('rejects a lowercase case code', () => {
    expect(containsToken('[PERSON_NAME_1|d]')).toBe(false);
  });

  it('rejects a case code with trailing garbage before the bracket', () => {
    expect(containsToken('[PERSON_NAME_1|Dd]')).toBe(false);
  });

  it('tokenId excludes the annotation, so the canonical bracket form is recoverable', () => {
    const [entry] = findTokens('[PERSON_NAME_1|D]');
    expect(entry.tokenId).toBe('PERSON_NAME_1');
    expect(`[${entry.tokenId}]`).toBe(entry.token);
  });

  it('isTokenLiteral accepts the annotated form but not an invalid one', () => {
    expect(isTokenLiteral('[PERSON_NAME_1|D]')).toBe(true);
    expect(isTokenLiteral('[PERSON_NAME_1|X]')).toBe(false);
  });
});

describe('bezstanowość (no shared lastIndex across interleaved calls)', () => {
  it('interleaved calls on different texts give the same results as isolated calls', () => {
    const textA = 'a [TYPE_1] b';
    const textB = 'c [OTHER_2] d [OTHER_3] e';
    const isolatedA = findTokens(textA);
    const isolatedB = findTokens(textB);

    const interleavedA1 = findTokens(textA);
    const interleavedB = findTokens(textB);
    const interleavedA2 = findTokens(textA);

    expect(interleavedA1).toEqual(isolatedA);
    expect(interleavedB).toEqual(isolatedB);
    expect(interleavedA2).toEqual(isolatedA);
  });
});

describe('containsToken', () => {
  it('is false for text with no tokens', () => {
    expect(containsToken('zwykły tekst bez tokenów')).toBe(false);
  });

  it('is true when at least one token is present among several candidates', () => {
    expect(containsToken('tekst [PERSON_NAME_1] dalej [ORGANIZATION_NAME_2]')).toBe(true);
  });
});

describe('splitTokenParts', () => {
  it('covers the whole text with alternating text/token segments', () => {
    const text = 'Powód [PERSON_NAME_1] przeciwko [PERSON_NAME_2].';
    expect(splitTokenParts(text)).toEqual([
      { text: 'Powód ' },
      { token: '[PERSON_NAME_1]', tokenId: 'PERSON_NAME_1', type: 'PERSON_NAME' },
      { text: ' przeciwko ' },
      { token: '[PERSON_NAME_2]', tokenId: 'PERSON_NAME_2', type: 'PERSON_NAME' },
      { text: '.' },
    ]);
  });

  it('returns a single text segment when there are no tokens', () => {
    expect(splitTokenParts('brak tokenów')).toEqual([{ text: 'brak tokenów' }]);
  });

  it('returns an empty array for empty text', () => {
    expect(splitTokenParts('')).toEqual([]);
  });

  it('never touches a legend — no orig field on token segments', () => {
    const [part] = splitTokenParts('[X_1]');
    expect(part).not.toHaveProperty('orig');
  });
});

describe('tokenType', () => {
  it('strips the trailing _n index', () => {
    expect(tokenType('PERSON_NAME_12')).toBe('PERSON_NAME');
  });

  it('leaves a type-only string (no trailing index) unchanged', () => {
    expect(tokenType('PERSON_NAME')).toBe('PERSON_NAME');
  });
});
