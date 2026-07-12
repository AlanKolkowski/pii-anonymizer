import { rulesFor } from '../configs/entity-rules.js';
import { TRIM_CHARS } from './trim-trailing-punctuation.js';

const SEPARATOR_CLASS = `[\\s${[...TRIM_CHARS].join('')}]`;
const LEADING_SEP = new RegExp(`^${SEPARATOR_CLASS}+`);
const TRAILING_SEP = new RegExp(`${SEPARATOR_CLASS}+$`);
const WORD_CHAR = /[\p{L}]/u;

// A9 (EVAL-RECALL-AUDIT §8): a span whose end falls immediately before
// another letter — no word boundary in between — is a truncated prefix of a
// longer word, not a complete one ("Wniosko" cut out of "Wnioskodawca").
// A genuine role/title is a complete word or phrase and always ends at a
// real boundary, so this is a general opt-in check, not a fixed dictionary.
function endsInsideWord(text, end) {
  return end < text.length && WORD_CHAR.test(text[end]);
}

function matchesBlocklist(slice, blocklistLower) {
  return blocklistLower.includes(slice.trim().toLowerCase());
}

function trimEdges(text, start, end, blocklistLower) {
  let curStart = start;
  let curEnd = end;
  let changed = true;
  while (changed && curStart < curEnd) {
    changed = false;
    const slice = text.slice(curStart, curEnd);

    for (const blocked of blocklistLower) {
      if (slice.length <= blocked.length) continue;
      if (slice.slice(0, blocked.length).toLowerCase() !== blocked) continue;
      const after = slice.slice(blocked.length);
      const sepMatch = after.match(LEADING_SEP);
      if (!sepMatch) continue;
      curStart += blocked.length + sepMatch[0].length;
      changed = true;
      break;
    }
    if (changed) continue;

    for (const blocked of blocklistLower) {
      const span = curEnd - curStart;
      if (span <= blocked.length) continue;
      const tail = text.slice(curStart, curEnd);
      if (tail.slice(-blocked.length).toLowerCase() !== blocked) continue;
      const before = tail.slice(0, -blocked.length);
      const sepMatch = before.match(TRAILING_SEP);
      if (!sepMatch) continue;
      curEnd -= blocked.length + sepMatch[0].length;
      changed = true;
      break;
    }
  }
  return { start: curStart, end: curEnd };
}

export function blocklistStep(ctx) {
  const { text, entities } = ctx;
  const out = [];
  for (const entity of entities) {
    const rules = rulesFor(entity.entity_group);
    if (rules.rejectTruncatedWord && endsInsideWord(text, entity.end)) continue;

    const hasWords = rules.blocklist && rules.blocklist.length > 0;
    const hasPatterns = rules.blocklistPatterns && rules.blocklistPatterns.length > 0;
    if (!hasWords && !hasPatterns) {
      out.push(entity);
      continue;
    }

    let start = entity.start;
    let end = entity.end;

    if (hasWords) {
      const blocklistLower = rules.blocklist.map((s) => s.toLowerCase());
      if (matchesBlocklist(text.slice(start, end), blocklistLower)) continue;
      ({ start, end } = trimEdges(text, start, end, blocklistLower));
      if (end <= start) continue;
      if (!text.slice(start, end).trim()) continue;
      if (matchesBlocklist(text.slice(start, end), blocklistLower)) continue;
    }

    if (hasPatterns) {
      const finalSlice = text.slice(start, end).trim();
      if (rules.blocklistPatterns.some((p) => p.test(finalSlice))) continue;
    }

    if (start === entity.start && end === entity.end) {
      out.push(entity);
    } else {
      out.push({ ...entity, start, end });
    }
  }
  return { ...ctx, entities: out };
}
