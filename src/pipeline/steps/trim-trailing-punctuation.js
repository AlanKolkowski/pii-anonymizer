import { CAT_A, CAT_B } from '../data/polish-abbreviations.js';
import { rulesFor } from '../configs/entity-rules.js';

export const TRIM_CHARS = new Set(['.', ',', ';', ':', '!', '?']);
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

export function trimTrailingPunctuationStep(ctx) {
  const { text, entities, segments } = ctx;
  if (!entities || entities.length === 0) return ctx;
  if (!segments || segments.length === 0) return ctx;

  const trimmed = entities.map((entity) => {
    if (!rulesFor(entity.entity_group).trimTrailingPunctuation) return entity;
    const lastChar = text[entity.end - 1];
    if (!TRIM_CHARS.has(lastChar)) return entity;
    const seg = findContainingSegment(segments, entity.end);
    if (!seg) return entity;
    const segEnd = seg.offset + seg.text.length;
    const after = text.slice(entity.end, segEnd);
    if (!TRAILING_WHITESPACE_RE.test(after)) return entity;
    if (lastChar === '.') {
      const entityText = text.slice(entity.start, entity.end);
      if (endsWithKnownAbbreviation(entityText)) return entity;
    }
    const word = typeof entity.word === 'string' && entity.word.endsWith(lastChar)
      ? entity.word.slice(0, -1)
      : entity.word;
    return {
      ...entity,
      end: entity.end - 1,
      word,
    };
  });

  return { ...ctx, entities: trimmed };
}
