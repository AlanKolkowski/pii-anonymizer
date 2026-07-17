import { groupCandidates, pendingValueKeys } from '../../review-engine.js';
import { TYPE_WEIGHTS } from '../../pipeline/configs/type-weights.js';

// ST-4 (SCOPE-TIERS-DESIGN.md §4.2): pure view-model for the W2 review
// bucket. Everything renders from the LOCAL document text and the ST-3
// engine state — no new data, no new egress. Groups are ordered by
// TYPE_WEIGHTS descending (art. 9-10 first, amounts last — the heaviest
// decisions first, the noise last, §4.2 pkt 3).

const CONTEXT_CAP = 160;
const SENTENCE_BREAK = /[.!?\n]/;

// ±1 sentence-ish window around one occurrence, capped — computed from the
// document text the card already holds. A lightweight approximation of the
// pipeline's segmenter is enough for a review hint; the value itself is
// rendered highlighted between `before` and `after`.
export function contextAround(text, start, end) {
  let from = start;
  while (from > 0 && start - from < CONTEXT_CAP && !SENTENCE_BREAK.test(text[from - 1])) from -= 1;
  let to = end;
  while (to < text.length && to - end < CONTEXT_CAP && !SENTENCE_BREAK.test(text[to])) to += 1;
  if (to < text.length && SENTENCE_BREAK.test(text[to]) && text[to] !== '\n') to += 1;
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, start).trimStart(),
    value: text.slice(start, end),
    after: text.slice(end, to).trimEnd() + (to < text.length ? '…' : ''),
  };
}

/**
 * @returns {{
 *   pendingCount: number,           // unresolved VALUES (badge N, not occurrences)
 *   complete: boolean,
 *   groups: Array<{
 *     type, label, weight,
 *     valueCount, occurrenceCount, pendingCount,
 *     values: Array<{ valueKey, value, occurrenceCount, context,
 *                     decision: 'mask'|'skip'|null, origin: 'user'|'bulk'|'dictionary'|null }>,
 *   }>,
 * }}
 */
export function buildReviewViewModel({ text, candidates, decisions, entityLabels = {} }) {
  const groupsByType = new Map();
  const grouped = groupCandidates(candidates ?? [], text ?? '');
  for (const group of grouped.values()) {
    const type = group.entity_group;
    if (!groupsByType.has(type)) {
      groupsByType.set(type, {
        type,
        label: entityLabels[type] ?? type,
        weight: TYPE_WEIGHTS[type] ?? 3,
        values: [],
      });
    }
    const first = group.occurrences[0];
    const record = decisions?.get(group.valueKey) ?? null;
    groupsByType.get(type).values.push({
      valueKey: group.valueKey,
      value: text.slice(first.start, first.end),
      occurrenceCount: group.occurrences.length,
      context: contextAround(text, first.start, first.end),
      decision: record?.decision ?? null,
      origin: record?.origin ?? null,
    });
  }

  const groups = [...groupsByType.values()]
    .map((group) => ({
      ...group,
      valueCount: group.values.length,
      occurrenceCount: group.values.reduce((sum, v) => sum + v.occurrenceCount, 0),
      pendingCount: group.values.filter((v) => v.decision === null).length,
    }))
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label, 'pl'));

  const pendingCount = pendingValueKeys(candidates ?? [], decisions, text ?? '').length;
  return { pendingCount, complete: pendingCount === 0, groups };
}
