const MAX_CHUNK_CHARS = 900;
const LANG = 'pl';

/**
 * Creates a sentence-aware segmentation step using Wikimedia's sentencex.
 * Each sentence becomes its own segment. Sentences longer than MAX_CHUNK_CHARS
 * are split into smaller chunks at whitespace boundaries.
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

    for (const b of boundaries) {
      if (b.text.length <= MAX_CHUNK_CHARS) {
        segments.push({ text: b.text, offset: b.start_index });
      } else {
        // Split oversized sentence at whitespace boundaries
        let pos = 0;
        while (pos < b.text.length) {
          let end = Math.min(pos + MAX_CHUNK_CHARS, b.text.length);
          if (end < b.text.length) {
            const lastSpace = b.text.lastIndexOf(' ', end);
            if (lastSpace > pos) end = lastSpace + 1;
          }
          segments.push({ text: b.text.slice(pos, end), offset: b.start_index + pos });
          pos = end;
        }
      }
    }

    return { ...ctx, segments };
  };
}
