import { CAT_A, CAT_B } from '../data/polish-abbreviations.js';
import { rulesFor } from '../configs/entity-rules.js';

const TRAILING_WHITESPACE_RE = /^\s*$/;
const LAST_TOKEN_RE = /(\S+)\s*$/;

function findContainingSegment(segments, pos) {
  for (const seg of segments) {
    const start = seg.offset;
    const end = seg.offset + seg.text.length;
    if (pos >= start && pos <= end) return seg;
  }
  return null;
}

function endsWithKnownAbbreviation(entityText) {
  const match = LAST_TOKEN_RE.exec(entityText);
  if (!match) return false;
  const token = match[1].toLowerCase();
  return CAT_A.has(token) || CAT_B.has(token);
}

export function trimTrailingDotStep(ctx) {
  const { text, entities, segments } = ctx;
  if (!entities || entities.length === 0) return ctx;
  if (!segments || segments.length === 0) return ctx;

  const trimmed = entities.map((entity) => {
    if (!rulesFor(entity.entity_group).trimTrailingDot) return entity;
    if (text[entity.end - 1] !== '.') return entity;
    const seg = findContainingSegment(segments, entity.end);
    if (!seg) return entity;
    const segEnd = seg.offset + seg.text.length;
    const after = text.slice(entity.end, segEnd);
    if (!TRAILING_WHITESPACE_RE.test(after)) return entity;
    const entityText = text.slice(entity.start, entity.end);
    if (endsWithKnownAbbreviation(entityText)) return entity;
    return {
      ...entity,
      end: entity.end - 1,
      word: typeof entity.word === 'string' ? entity.word.replace(/\.$/, '') : entity.word,
    };
  });

  return { ...ctx, entities: trimmed };
}
