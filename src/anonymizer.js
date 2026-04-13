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

export function deanonymizeText(text, legend) {
  let result = text;
  for (const [token, value] of Object.entries(legend)) {
    result = result.replaceAll(token, value);
  }
  return result;
}
