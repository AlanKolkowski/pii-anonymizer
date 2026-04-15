export function overlapRatio(a, b) {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  if (start >= end) return 0;
  const overlap = end - start;
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return overlap / union;
}

export function matchEntities(expected, predicted, { overlapThreshold = 0.5, requireTypeMatch = true } = {}) {
  const matched = [];
  const usedPredicted = new Set();

  for (const exp of expected) {
    let bestIdx = -1;
    let bestOverlap = 0;

    for (let i = 0; i < predicted.length; i++) {
      if (usedPredicted.has(i)) continue;
      if (requireTypeMatch && predicted[i].entity_group !== exp.entity_group) continue;

      const overlap = overlapRatio(exp, predicted[i]);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestOverlap >= overlapThreshold) {
      matched.push({ expected: exp, predicted: predicted[bestIdx], overlap: bestOverlap });
      usedPredicted.add(bestIdx);
    }
  }

  const missed = expected.filter((_, i) => !matched.some(m => m.expected === expected[i]));
  const spurious = predicted.filter((_, i) => !usedPredicted.has(i));

  // Detect type mismatches: missed & spurious that overlap (detected, but wrong category)
  const typeMismatched = [];
  if (requireTypeMatch) {
    const usedMissedIdx = new Set();
    const usedSpuriousIdx = new Set();

    for (let mi = 0; mi < missed.length; mi++) {
      let bestSi = -1;
      let bestOv = 0;

      for (let si = 0; si < spurious.length; si++) {
        if (usedSpuriousIdx.has(si)) continue;
        const ov = overlapRatio(missed[mi], spurious[si]);
        if (ov > bestOv) {
          bestOv = ov;
          bestSi = si;
        }
      }

      if (bestSi >= 0 && bestOv >= overlapThreshold) {
        typeMismatched.push({
          expected: missed[mi],
          predicted: spurious[bestSi],
          overlap: bestOv,
        });
        usedMissedIdx.add(mi);
        usedSpuriousIdx.add(bestSi);
      }
    }

    return {
      matched,
      missed: missed.filter((_, i) => !usedMissedIdx.has(i)),
      spurious: spurious.filter((_, i) => !usedSpuriousIdx.has(i)),
      typeMismatched,
    };
  }

  return { matched, missed, spurious, typeMismatched };
}
