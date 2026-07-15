import { couldBeSamePerson } from '../../anonymizer.js';
import { rulesFor } from '../configs/entity-rules.js';

const CAP_WORD = '[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:-[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*';
const NAME_CANDIDATE = new RegExp(`${CAP_WORD}(?:\\s+${CAP_WORD})+`, 'g');

const MIN_VALUE_LENGTH = 2;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWordBoundaryRegex(value, caseInsensitive = false) {
  const flags = caseInsensitive ? 'giu' : 'gu';
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(value)}(?![\\p{L}\\p{N}_])`, flags);
}

function positionKey(start, end) {
  return `${start}:${end}`;
}

// ST-2 H-2 (SCOPE-TIERS-DESIGN.md §3.2 pkt 4): optional `tierOf` resolver —
// (entity) => 'mask'|'review'|'pass'. Omitted (all existing call sites),
// every span blocks a backfill candidate exactly as today. Given, a 'pass'
// span (e.g. an organization name) doesn't hide its characters, so it must
// not block a name known from elsewhere in the document from being backfilled
// inside it — only 'mask' and 'review' spans still count as occupied.
function overlapsAny(start, end, spans, tierOf) {
  for (const s of spans) {
    if (tierOf && tierOf(s) === 'pass') continue;
    if (start < s.end && end > s.start) return true;
  }
  return false;
}

export function backfillOccurrencesStep(ctx, tierOf) {
  const { text, entities } = ctx;
  if (!entities || entities.length === 0) return ctx;

  // Per type: dedupe values by case-insensitive key when the rule asks for it,
  // so we don't run multiple equivalent scans (e.g., "Acme Corp" and "acme corp"
  // would both spawn a scan that finds the same matches).
  const byType = new Map();
  for (const e of entities) {
    const rules = rulesFor(e.entity_group);
    if (!rules.backfill) continue;
    const value = text.slice(e.start, e.end);
    if (value.length < MIN_VALUE_LENGTH) continue;
    if (!byType.has(e.entity_group)) byType.set(e.entity_group, new Map());
    const valuesMap = byType.get(e.entity_group);
    const key = rules.caseInsensitiveBackfill ? value.toLowerCase() : value;
    if (!valuesMap.has(key)) valuesMap.set(key, value);
  }

  const additions = [];
  const addIfFree = (entity_group, start, end) => {
    if (overlapsAny(start, end, entities, tierOf)) return;
    if (overlapsAny(start, end, additions, tierOf)) return;
    additions.push({ entity_group, start, end, score: 1.0, source: 'rescan' });
  };

  for (const [type, valuesMap] of byType) {
    const rules = rulesFor(type);
    for (const value of valuesMap.values()) {
      for (const m of text.matchAll(buildWordBoundaryRegex(value, rules.caseInsensitiveBackfill))) {
        addIfFree(type, m.index, m.index + m[0].length);
      }
    }
  }

  for (const [type, valuesMap] of byType) {
    const rules = rulesFor(type);
    if (!rules.fuzzyBackfill) continue;
    for (const m of text.matchAll(NAME_CANDIDATE)) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlapsAny(start, end, entities, tierOf)) continue;
      if (overlapsAny(start, end, additions, tierOf)) continue;
      for (const value of valuesMap.values()) {
        if (couldBeSamePerson(m[0], value)) {
          addIfFree(type, start, end);
          break;
        }
      }
    }
  }

  if (additions.length === 0) return ctx;
  return { ...ctx, entities: [...entities, ...additions] };
}
