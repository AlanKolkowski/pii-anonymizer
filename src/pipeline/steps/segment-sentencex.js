const MAX_CHUNK_CHARS = 900;
const LANG = 'pl';

/**
 * Converts a Unicode code-point index into a UTF-16 code-unit offset within str.
 * sentencex reports sentence indices as code points, while JS string slicing and
 * every downstream pipeline span use UTF-16 offsets.
 */
function codePointToUtf16(str, codePointIndex) {
  let codePoints = 0;
  let offset = 0;
  while (codePoints < codePointIndex && offset < str.length) {
    offset += str.codePointAt(offset) > 0xffff ? 2 : 1;
    codePoints += 1;
  }
  return offset;
}

/**
 * Creates a sentence-aware segmentation step using Wikimedia's sentencex.
 * Each sentence becomes its own segment. Sentences longer than MAX_CHUNK_CHARS
 * are split into smaller chunks at whitespace boundaries.
 *
 * sentencex returns code-point indices, but the pipeline stores UTF-16 offsets
 * into ctx.text. Locate each sentence text with a forward cursor so segment
 * offsets stay compatible with NER, regex, snap, and tokenization spans.
 *
 * @param {Function} getSentenceBoundaries - (lang, text) => [{start_index, end_index, text}, ...]
 */
export function createSentencexSegmentStep(getSentenceBoundaries) {
  return function segmentSentencexStep(ctx) {
    const { text } = ctx;

    if (!text) {
      return { ...ctx, segments: [{ text, offset: 0 }] };
    }

    const boundaries = getSentenceBoundaries(LANG, text);

    if (boundaries.length === 0) {
      return { ...ctx, segments: [{ text, offset: 0 }] };
    }

    const segments = [];
    let cursor = 0;

    for (const b of boundaries) {
      let base = text.indexOf(b.text, cursor);
      if (base === -1) {
        base = codePointToUtf16(text, b.start_index);
      }
      cursor = base + b.text.length;

      if (b.text.length <= MAX_CHUNK_CHARS) {
        segments.push({ text: b.text, offset: base });
      } else {
        // Split oversized sentence at whitespace boundaries. pos is UTF-16-local
        // to b.text, so base + pos remains a UTF-16 offset into ctx.text.
        let pos = 0;
        while (pos < b.text.length) {
          let end = Math.min(pos + MAX_CHUNK_CHARS, b.text.length);
          if (end < b.text.length) {
            const lastSpace = b.text.lastIndexOf(' ', end);
            if (lastSpace > pos) end = lastSpace + 1;
          }
          segments.push({ text: b.text.slice(pos, end), offset: base + pos });
          pos = end;
        }
      }
    }

    return { ...ctx, segments };
  };
}
