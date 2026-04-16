const LIST_MARKER_RE = /^(\d+|[IVXLCDM]+|[a-z])\.$/;

function isListMarker(segText) {
  return LIST_MARKER_RE.test(segText.trim());
}

function sliceMerged(originalText, segA, segB) {
  const start = segA.offset;
  const end = segB.offset + segB.text.length;
  return { text: originalText.slice(start, end), offset: start };
}

function shouldMerge(prev, next, originalText) {
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
