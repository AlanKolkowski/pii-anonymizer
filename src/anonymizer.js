export function buildTokenMap(entities, originalText) {
  const counters = {};
  const seen = {};
  const legend = {};

  for (const entity of entities) {
    const value = originalText.slice(entity.start, entity.end);
    const type = entity.entity_group;
    const key = `${type}::${value}`;

    if (!seen[key]) {
      counters[type] = (counters[type] || 0) + 1;
      const token = `[${type}_${counters[type]}]`;
      seen[key] = token;
      legend[token] = value;
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

export function deanonymizeText(text, legend) {
  let result = text;
  for (const [token, value] of Object.entries(legend)) {
    result = result.replaceAll(token, value);
  }
  return result;
}
