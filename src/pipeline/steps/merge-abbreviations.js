const LIST_MARKER_RE = /^(\d+|[IVXLCDM]+|[a-z])\.$/;
const PARAGRAPH_BREAK_RE = /\n\s*\n/;

function isListMarker(segText) {
  return LIST_MARKER_RE.test(segText.trim());
}

function hasParagraphBreakBetween(prev, next, originalText) {
  const start = prev.offset + prev.text.length;
  const end = next.offset;
  if (end <= start) return false;
  return PARAGRAPH_BREAK_RE.test(originalText.slice(start, end));
}

function sliceMerged(originalText, segA, segB) {
  const start = segA.offset;
  const end = segB.offset + segB.text.length;
  return { text: originalText.slice(start, end), offset: start };
}

function shouldMerge(prev, next, originalText) {
  if (hasParagraphBreakBetween(prev, next, originalText)) return null;
  if (isListMarker(prev.text)) return 'R3';
  return null;
}

export function mergeAbbreviationsStep(ctx) {
  const { text, segments } = ctx;
  if (!segments || segments.length < 2) {
    return ctx;
  }

  const out = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = out[out.length - 1];
    const curr = segments[i];
    const rule = shouldMerge(prev, curr, text);
    if (rule) {
      out[out.length - 1] = sliceMerged(text, prev, curr);
    } else {
      out.push(curr);
    }
  }

  return { ...ctx, segments: out };
}
