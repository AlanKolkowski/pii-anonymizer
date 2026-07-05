import { buildTokenMap } from '../../anonymizer.js';

export function overlapsAny(start, end, entities, ignoreIndex = -1) {
  for (let i = 0; i < entities.length; i++) {
    if (i === ignoreIndex) continue;
    const e = entities[i];
    if (start < e.end && end > e.start) return true;
  }
  return false;
}

export function addEntity(entities, candidate) {
  if (overlapsAny(candidate.start, candidate.end, entities)) return entities;
  return [...entities, candidate];
}

function tokenForEntity(entity, text, legend) {
  const value = text.slice(entity.start, entity.end);
  for (const [token, original] of Object.entries(legend)) {
    if (original === value) {
      const expectedPrefix = `[${entity.entity_group}_`;
      if (token.startsWith(expectedPrefix)) return token;
    }
  }
  return null;
}

export function tokensFromEntities(entities, text, globalSeen = null) {
  const { seen, legend } = buildTokenMap(entities, text);
  const result = new Map();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const value = text.slice(e.start, e.end);
    const key = `${e.entity_group}::${value}`;
    const token = globalSeen?.[key] ?? seen[key];
    result.set(i, token);
  }
  return result;
}

export function removeToken(entities, anchor, text, globalSeen = null) {
  const tokens = tokensFromEntities(entities, text, globalSeen);
  const anchorIndex = entities.indexOf(anchor);
  if (anchorIndex < 0) return entities;
  const targetToken = tokens.get(anchorIndex);
  if (!targetToken) return entities;
  return entities.filter((_, i) => tokens.get(i) !== targetToken);
}

export function updateTypeForToken(entities, anchor, newType, text, globalSeen = null) {
  const tokens = tokensFromEntities(entities, text, globalSeen);
  const anchorIndex = entities.indexOf(anchor);
  if (anchorIndex < 0) return entities;
  const targetToken = tokens.get(anchorIndex);
  if (!targetToken) return entities;
  return entities.map((e, i) =>
    tokens.get(i) === targetToken ? { ...e, entity_group: newType } : e,
  );
}

export function updateBoundaries(entities, index, newStart, newEnd) {
  if (newEnd <= newStart) return null;
  if (overlapsAny(newStart, newEnd, entities, index)) return null;
  return entities.map((e, i) =>
    i === index ? { ...e, start: newStart, end: newEnd } : e,
  );
}
