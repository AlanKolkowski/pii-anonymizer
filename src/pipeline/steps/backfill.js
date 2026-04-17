import { couldBeSamePerson } from '../../anonymizer.js';

const CAP_WORD = '[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:-[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*';
const NAME_CANDIDATE = new RegExp(`${CAP_WORD}(?:\\s+${CAP_WORD})+`, 'g');

const MIN_VALUE_LENGTH = 2;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWordBoundaryRegex(value) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(value)}(?![\\p{L}\\p{N}_])`, 'gu');
}

function positionKey(start, end) {
  return `${start}:${end}`;
}

function overlapsAny(start, end, spans) {
  for (const s of spans) {
    if (start < s.end && end > s.start) return true;
  }
  return false;
}

export function backfillOccurrencesStep(ctx) {
  const { text, entities } = ctx;
  if (!entities || entities.length === 0) return ctx;

  const byType = new Map();
  for (const e of entities) {
    const value = text.slice(e.start, e.end);
    if (value.length < MIN_VALUE_LENGTH) continue;
    if (!byType.has(e.entity_group)) byType.set(e.entity_group, new Set());
    byType.get(e.entity_group).add(value);
  }

  const additions = [];
  const addIfFree = (entity_group, start, end) => {
    if (overlapsAny(start, end, entities)) return;
    if (overlapsAny(start, end, additions)) return;
    additions.push({ entity_group, start, end, score: 1.0, source: 'rescan' });
  };

  for (const [type, values] of byType) {
    for (const value of values) {
      for (const m of text.matchAll(buildWordBoundaryRegex(value))) {
        addIfFree(type, m.index, m.index + m[0].length);
      }
    }
  }

  const nameValues = byType.get('PERSON_NAME');
  if (nameValues && nameValues.size > 0) {
    for (const m of text.matchAll(NAME_CANDIDATE)) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlapsAny(start, end, entities)) continue;
      if (overlapsAny(start, end, additions)) continue;
      for (const value of nameValues) {
        if (couldBeSamePerson(m[0], value)) {
          addIfFree('PERSON_NAME', start, end);
          break;
        }
      }
    }
  }

  if (additions.length === 0) return ctx;
  return { ...ctx, entities: [...entities, ...additions] };
}
