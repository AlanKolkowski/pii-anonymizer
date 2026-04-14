function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function wordsMatch(w1, w2) {
  const a = w1.toLowerCase();
  const b = w2.toLowerCase();
  const shorter = Math.min(a.length, b.length);
  const prefixLen = commonPrefixLength(a, b);
  // The shorter word must match all but at most 2 ending characters.
  // This handles Polish declension where endings change by 1-2 chars
  // while the stem (prefix) stays the same.
  return prefixLen >= Math.max(3, shorter - 2);
}

export function couldBeSamePerson(name1, name2) {
  const words1 = name1.split(/\s+/);
  const words2 = name2.split(/\s+/);

  if (words1.length === words2.length) {
    return words1.every((w, i) => wordsMatch(w, words2[i]));
  }

  // Different word count: check if all words of the shorter name
  // match a subset of the longer name's words
  const [shorter, longer] =
    words1.length < words2.length ? [words1, words2] : [words2, words1];

  const used = new Set();
  for (const sw of shorter) {
    let found = false;
    for (let i = 0; i < longer.length; i++) {
      if (!used.has(i) && wordsMatch(sw, longer[i])) {
        used.add(i);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function createNameNormalizer() {
  const groups = [];

  return function (name) {
    for (const group of groups) {
      if (couldBeSamePerson(name, group.canonical)) {
        return group.canonical;
      }
    }
    groups.push({ canonical: name });
    return name;
  };
}

export function buildTokenMap(entities, originalText) {
  const counters = {};
  const seen = {};
  const legend = {};
  const normalizeName = createNameNormalizer();

  for (const entity of entities) {
    const value = originalText.slice(entity.start, entity.end);
    const type = entity.entity_group;
    const normalizedValue =
      type === 'PERSON_NAME' ? normalizeName(value) : value;
    const canonicalKey = `${type}::${normalizedValue}`;

    if (!seen[canonicalKey]) {
      counters[type] = (counters[type] || 0) + 1;
      const token = `[${type}_${counters[type]}]`;
      seen[canonicalKey] = token;
      legend[token] = value;
    }

    // Also index by raw value so anonymizeText can look up by exact text
    const rawKey = `${type}::${value}`;
    if (rawKey !== canonicalKey) {
      seen[rawKey] = seen[canonicalKey];
    }
  }

  return { seen, legend };
}

export function anonymizeText(text, entities) {
  const { seen, legend } = buildTokenMap(entities, text);

  const positionsSeen = new Set();
  const unique = [];
  for (const entity of entities) {
    const posKey = `${entity.start}:${entity.end}`;
    if (!positionsSeen.has(posKey)) {
      positionsSeen.add(posKey);
      unique.push(entity);
    }
  }
  unique.sort((a, b) => b.start - a.start);

  let result = text;
  for (const entity of unique) {
    const value = text.slice(entity.start, entity.end);
    const key = `${entity.entity_group}::${value}`;
    const token = seen[key];
    result = result.slice(0, entity.start) + token + result.slice(entity.end);
  }

  return { anonymized: result, legend };
}

export function aggregateEntities(rawTokens, originalText) {
  // Reconstruct character positions by finding each sub-word in the text
  let pos = 0;
  const tokens = rawTokens.map((token) => {
    const idx = originalText.indexOf(token.word, pos);
    const start = idx >= 0 ? idx : pos;
    const end = start + token.word.length;
    pos = end;
    return { ...token, start, end };
  });

  // Merge consecutive tokens of the same entity type.
  // Allow index gaps of ≤2 (handles spaces between phone digits, etc.)
  // Merge regardless of B-/I- prefix (handles models that tag all tokens as B-)
  const groups = [];
  let current = null;

  for (const token of tokens) {
    const type = token.entity.replace(/^[BI]-/, '');

    const shouldMerge =
      current &&
      current.type === type &&
      token.index - current.lastIndex <= 2;

    if (shouldMerge) {
      current.end = token.end;
      current.scores.push(token.score);
      current.lastIndex = token.index;
    } else {
      if (current) groups.push(current);
      current = {
        type,
        start: token.start,
        end: token.end,
        scores: [token.score],
        lastIndex: token.index,
      };
    }
  }
  if (current) groups.push(current);

  return groups.map((g) => ({
    entity_group: g.type,
    start: g.start,
    end: g.end,
    score: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
  }));
}

export function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [{ text, offset: 0 }];

  // Prefer paragraph boundaries (\n\n+), fall back to lines (\n), then characters
  const paraBreaks = [0];
  for (const m of text.matchAll(/\n\n+/g)) {
    paraBreaks.push(m.index + m[0].length);
  }
  paraBreaks.push(text.length);

  if (paraBreaks.length >= 3) { // need at least one real \n\n break (not just 0 + text.length)
    const chunks = [];
    let from = 0;
    let fromIdx = 0;

    for (let i = 1; i < paraBreaks.length; i++) {
      if (paraBreaks[i] - from > maxChars) {
        if (i > fromIdx + 1) {
          chunks.push({ text: text.slice(from, paraBreaks[i - 1]), offset: from });
          from = paraBreaks[i - 1];
          fromIdx = i - 1;
        } else {
          // Single paragraph exceeds maxChars — include it as-is
          chunks.push({ text: text.slice(from, paraBreaks[i]), offset: from });
          from = paraBreaks[i];
          fromIdx = i;
        }
      }
    }
    if (from < text.length) {
      chunks.push({ text: text.slice(from, text.length), offset: from });
    }
    return chunks;
  }

  // Fallback: line-based
  const lineBreaks = [0];
  for (const m of text.matchAll(/\n/g)) {
    lineBreaks.push(m.index + 1);
  }

  if (lineBreaks.length >= 2) {
    const chunks = [];
    let from = 0;

    for (let i = 1; i < lineBreaks.length; i++) {
      if (lineBreaks[i] - from > maxChars && lineBreaks[i - 1] > from) {
        chunks.push({ text: text.slice(from, lineBreaks[i - 1]), offset: from });
        from = lineBreaks[i - 1];
      }
    }
    if (from < text.length) {
      chunks.push({ text: text.slice(from, text.length), offset: from });
    }
    return chunks;
  }

  // Fallback: character-based
  const chunks = [];
  for (let pos = 0; pos < text.length; pos += maxChars) {
    const end = Math.min(pos + maxChars, text.length);
    chunks.push({ text: text.slice(pos, end), offset: pos });
  }
  return chunks;
}

export function findRegexEntities(text) {
  const patterns = [
    { regex: /[\w.+-]+@[\w.-]+\.\w{2,}/g, entity_group: 'EMAIL_ADDRESS' },
    { regex: /\b\d{11}\b/g, entity_group: 'PERSON_IDENTIFIER' },
    { regex: /\b\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}\b/g, entity_group: 'ORGANIZATION_IDENTIFIER' },
    { regex: /\bPL\s?\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}\b/g, entity_group: 'BANK_ACCOUNT_IDENTIFIER' },
    { regex: /\+?\d{2}[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, entity_group: 'PHONE_NUMBER' },
  ];

  const entities = [];
  for (const { regex, entity_group } of patterns) {
    for (const m of text.matchAll(regex)) {
      entities.push({
        entity_group,
        start: m.index,
        end: m.index + m[0].length,
        score: 1.0,
      });
    }
  }
  return entities;
}

const ADDRESS_TYPES = new Set(['POSTAL_ADDRESS', 'LOCATION']);

export function mergeAdjacentEntities(entities, text) {
  if (entities.length <= 1) return entities;

  // Sort by position
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const result = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    const curr = sorted[i];

    if (ADDRESS_TYPES.has(prev.entity_group) && ADDRESS_TYPES.has(curr.entity_group)) {
      const gap = text.slice(prev.end, curr.start);
      if (gap.length <= 3 && /^[\s,\n]*$/.test(gap)) {
        // Merge into one POSTAL_ADDRESS
        result[result.length - 1] = {
          entity_group: 'POSTAL_ADDRESS',
          start: prev.start,
          end: curr.end,
          score: Math.max(prev.score, curr.score),
        };
        continue;
      }
    }

    result.push(curr);
  }

  return result;
}

export function deduplicateEntities(entities) {
  if (entities.length <= 1) return entities;

  entities.sort((a, b) => a.start - b.start || b.score - a.score);

  const result = [entities[0]];
  for (let i = 1; i < entities.length; i++) {
    const prev = result[result.length - 1];
    const curr = entities[i];

    if (curr.start < prev.end) {
      // Prefer wider span, then higher score
      const prevSpan = prev.end - prev.start;
      const currSpan = curr.end - curr.start;
      if (currSpan > prevSpan || (currSpan === prevSpan && curr.score > prev.score)) {
        result[result.length - 1] = curr;
      }
    } else {
      result.push(curr);
    }
  }

  return result;
}

export function deanonymizeText(text, legend) {
  let result = text;
  for (const [token, value] of Object.entries(legend)) {
    result = result.replaceAll(token, value);
  }
  return result;
}
