const HAS_CONTENT = /[\p{L}\p{N}]/u;

function splitLines(text) {
  const lines = [];
  let pos = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      lines.push({ start: pos, end: i, text: text.slice(pos, i) });
      pos = i + 1;
    }
  }
  return lines;
}

export function tightenSegment(seg) {
  const { text, offset } = seg;
  const lines = splitLines(text);

  const firstIdx = lines.findIndex(l => HAS_CONTENT.test(l.text));
  if (firstIdx === -1) return null;

  let lastIdx = lines.length - 1;
  while (lastIdx > firstIdx && !HAS_CONTENT.test(lines[lastIdx].text)) lastIdx--;

  const first = lines[firstIdx];
  const last = lines[lastIdx];
  const leading = first.text.length - first.text.trimStart().length;
  const trailing = last.text.length - last.text.trimEnd().length;
  const startLocal = first.start + leading;
  const endLocal = last.end - trailing;

  return {
    text: text.slice(startLocal, endLocal),
    offset: offset + startLocal,
  };
}

export function tightenSegmentsStep(ctx) {
  const { segments } = ctx;
  if (!segments || segments.length === 0) return ctx;

  const out = [];
  for (const seg of segments) {
    const tightened = tightenSegment(seg);
    if (tightened) out.push(tightened);
  }
  return { ...ctx, segments: out };
}
