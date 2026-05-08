// Group recognized boxes into lines and concatenate.
//
// Each box: { text, confidence, box: { x, y, w, h } } with x/y at top-left.
// Two boxes belong to the same line if their y-center delta is < min(h)/2 — a
// half-line-height tolerance handles small vertical wobble in detection output.
export function boxesToText(boxes) {
  const filtered = boxes.filter((b) => b.text && b.text.length > 0);
  if (filtered.length === 0) return '';

  const sorted = [...filtered].sort((a, b) => yCenter(a) - yCenter(b));
  const lines = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1];
    const next = sorted[i];
    const tolerance = Math.min(prev.box.h, next.box.h) / 2;
    if (Math.abs(yCenter(next) - yCenter(prev)) <= tolerance) {
      current.push(next);
    } else {
      lines.push(current);
      current = [next];
    }
  }
  lines.push(current);

  return lines
    .map((line) =>
      line
        .sort((a, b) => a.box.x - b.box.x)
        .map((b) => b.text)
        .join(' ')
    )
    .join('\n');
}

export function meanConfidence(boxes) {
  if (!boxes || boxes.length === 0) return null;
  const sum = boxes.reduce((acc, b) => acc + (b.confidence ?? 0), 0);
  return sum / boxes.length;
}

function yCenter(b) {
  return b.box.y + b.box.h / 2;
}
