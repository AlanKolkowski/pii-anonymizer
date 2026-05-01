import { ENTITY_SOURCES, SOURCES } from '../src/pipeline/configs/entity-sources.js';

function sumSizeMB(aliases, sources) {
  let total = 0;
  for (const a of aliases) total += sources[a]?.sizeMB ?? 0;
  return total;
}

function canonicalKey(aliases) {
  return [...aliases].sort().join('+');
}

export function deriveCases({ entitySources = ENTITY_SOURCES, sources = SOURCES, entityTypes = null } = {}) {
  const types = entityTypes ?? Object.keys(entitySources);
  const seen = new Map();
  const allModelSet = new Set();

  for (const type of types) {
    const raw = entitySources[type];
    if (!raw || raw.length === 0) continue;
    const modelOnly = raw.filter((a) => sources[a]?.kind === 'hf');
    for (const a of modelOnly) allModelSet.add(a);
    if (modelOnly.length === 0) continue;
    const key = canonicalKey(modelOnly);
    if (seen.has(key)) continue;
    seen.set(key, {
      label: key,
      kind: 'single-entity',
      entities: [type],
      representativeEntity: type,
      sources: [...modelOnly].sort(),
      sizeMB: sumSizeMB(modelOnly, sources),
    });
  }

  const cases = [...seen.values()].sort((a, b) => a.sizeMB - b.sizeMB || a.label.localeCompare(b.label));

  if (allModelSet.size > 0) {
    const allModelSources = [...allModelSet].sort();
    cases.push({
      label: 'all-entities',
      kind: 'all-entities',
      entities: [...types],
      representativeEntity: null,
      sources: allModelSources,
      sizeMB: sumSizeMB(allModelSources, sources),
    });
  }

  return cases;
}

export function uniqueModelAliases(cases) {
  const set = new Set();
  for (const c of cases) for (const a of c.sources) set.add(a);
  return [...set].sort();
}
