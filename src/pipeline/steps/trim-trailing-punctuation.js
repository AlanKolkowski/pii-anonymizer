import { CAT_A, CAT_B } from '../data/polish-abbreviations.js';
import { rulesFor } from '../configs/entity-rules.js';

export const TRIM_CHARS = new Set(['.', ',', ';', ':', '!', '?']);
export const QUOTE_CHARS = new Set([
  '"', "'",
  '\u201E', // „ low-9
  '\u201C', // " left double
  '\u201D', // " right double
  '\u2018', // ' left single
  '\u2019', // ' right single
  '\u00AB', // «
  '\u00BB', // »
  '\u2039', // ‹
  '\u203A', // ›
]);
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
    let { start, end } = entity;
    let word = entity.word;

    if (end > start && QUOTE_CHARS.has(text[start])) {
      const ch = text[start];
      start += 1;
      if (typeof word === 'string' && word.startsWith(ch)) {
        word = word.slice(1);
      }
    }

    if (end > start) {
      const lastChar = text[end - 1];
      if (TRIM_CHARS.has(lastChar)) {
        let doTrim = true;
        if (lastChar === '.') {
          const seg = findContainingSegment(segments, end);
          if (!seg) {
            doTrim = false;
          } else {
            const segEnd = seg.offset + seg.text.length;
            const after = text.slice(end, segEnd);
            if (!TRAILING_WHITESPACE_RE.test(after)) {
              doTrim = false;
            } else {
              const entityText = text.slice(start, end);
              if (endsWithKnownAbbreviation(entityText)) doTrim = false;
            }
          }
        }
        if (doTrim) {
          if (typeof word === 'string' && word.endsWith(lastChar)) {
            word = word.slice(0, -1);
          }
          end -= 1;
        }
      }
    }

    if (end > start && QUOTE_CHARS.has(text[end - 1])) {
      const ch = text[end - 1];
      end -= 1;
      if (typeof word === 'string' && word.endsWith(ch)) {
        word = word.slice(0, -1);
      }
    }

    if (start === entity.start && end === entity.end) return entity;
    return { ...entity, start, end, word };
  });

  return { ...ctx, entities: trimmed };
}
