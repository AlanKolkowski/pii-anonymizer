// Shared helpers for cross-subset comparisons. When two runs were scored
// against different `enabledEntities` sets, aggregate deltas are misleading
// (the pipeline is non-distributive over types) — so the UI/CLI surfaces a
// `≠types` marker instead of a delta.

export function sameEnabledSets(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(x => set.has(x));
}

export const NEQ_MARKER = '  ≠types';

export const NEQ_DELTA_HTML =
  ' <span class="delta-neq" title="different scored entity set; absolute values shown">≠types</span>';
