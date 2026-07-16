// ST-8 (SCOPE-TIERS-DESIGN.md §8.1 pkt 4, mechanism from §6.2 pkt 5):
// comparability guard for eval runs. Score files written before the tiered
// scorer carry no scoringVersion; runs scored under different scoring
// versions or different tier configurations must never be diffed as if the
// numbers meant the same thing — the comparer prints an explicit warning
// and hides the deltas instead of showing quiet lies.

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {object|null} oldScores - parsed scores.json of the OLD run (or null)
 * @param {object|null} newScores - parsed scores.json of the NEW run (or null)
 * @returns {{ comparable: boolean, reasons: string[] }} — comparable=false
 *   means score deltas must be hidden; reasons carry operator-facing lines.
 */
export function scoreComparability(oldScores, newScores) {
  if (!oldScores || !newScores) return { comparable: true, reasons: [] };
  const reasons = [];

  const oldVersion = oldScores.scoringVersion ?? null;
  const newVersion = newScores.scoringVersion ?? null;
  if (oldVersion !== newVersion) {
    const describe = (v) => (v === null ? 'brak (format sprzed piwotu)' : v);
    reasons.push(`scoringVersion differs — OLD: ${describe(oldVersion)}, NEW: ${describe(newVersion)}.`);
  }

  const oldTiers = oldScores.tiersConfig ?? null;
  const newTiers = newScores.tiersConfig ?? null;
  if (stableStringify(oldTiers) !== stableStringify(newTiers)) {
    reasons.push('tiersConfig differs — the W1/W2/W3 split is not the same measurement.');
  }

  return { comparable: reasons.length === 0, reasons };
}
