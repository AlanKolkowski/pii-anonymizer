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

// A globalSeen override must win or lose for a whole canonical GROUP at
// once, never per raw text form independently. buildTokenMap already folds
// Polish-declined forms of one name onto a single LOCAL token (ingestSource,
// anonymizer.js); a globalSeen that has only seen SOME of a group's raw
// forms (e.g. a cross-document legend that knows "Kowalski" from another,
// already-processed source, but not yet this document's own "Kowalskiego")
// used to split one canonical person into two different token identities —
// whichever entity's exact raw text happened to be a globalSeen hit got the
// global token, its sibling fell back to the local one. That silently broke
// every caller that groups entities by "same token": removeToken (a
// declined-form occurrence could survive a delete that should have caught
// it — see operations.test.js and review-engine's ST-3 twin audit), the
// hover-highlight (data-token), and the annotation editor's own delete
// confirmation count (render.test.js).
export function tokensFromEntities(entities, text, globalSeen = null) {
  const { seen } = buildTokenMap(entities, text);
  const rawKeyOf = (e) => `${e.entity_group}::${text.slice(e.start, e.end)}`;

  const globalOverrideByLocalToken = new Map();
  if (globalSeen) {
    for (const e of entities) {
      const localToken = seen[rawKeyOf(e)];
      if (globalOverrideByLocalToken.has(localToken)) continue;
      const hit = globalSeen[rawKeyOf(e)];
      if (hit) globalOverrideByLocalToken.set(localToken, hit);
    }
  }

  const result = new Map();
  for (let i = 0; i < entities.length; i++) {
    const localToken = seen[rawKeyOf(entities[i])];
    result.set(i, globalOverrideByLocalToken.get(localToken) ?? localToken);
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
