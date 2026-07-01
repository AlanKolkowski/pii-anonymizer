import { describe, it, expect } from 'vitest';
import { createSentencexSegmentStep } from './segment-sentencex.js';

// sentencex reports start_index/end_index as CODE-POINT indices, not UTF-16
// offsets. This fake reproduces that contract for issue #16.
function codePointBoundaries(sentences) {
  let cpStart = 0;
  return sentences.map((text) => {
    const cpLen = Array.from(text).length;
    const boundary = { start_index: cpStart, end_index: cpStart + cpLen, text };
    cpStart += cpLen;
    return boundary;
  });
}

function makeCtx(text) {
  return { text, segments: [], entities: [], anonymized: '', legend: {} };
}

function assertSliceInvariant(source, segments) {
  for (const segment of segments) {
    expect(source.slice(segment.offset, segment.offset + segment.text.length)).toBe(segment.text);
  }
}

describe('segmentSentencexStep', () => {
  it('keeps UTF-16 offsets when astral chars precede a later sentence', () => {
    const sentences = ['😀😀😀 Pierwsze zdanie. ', 'Pan Kowalski zapłacił.'];
    const text = sentences.join('');
    expect(text.length).toBeGreaterThan(Array.from(text).length);

    const step = createSentencexSegmentStep(() => codePointBoundaries(sentences));
    const result = step(makeCtx(text));

    assertSliceInvariant(text, result.segments);
  });

  it('keeps UTF-16 offsets in the long-sentence chunking branch after astral chars', () => {
    const longSentence = `${'wyraz '.repeat(200).trim()}.`;
    const sentences = ['😀😀 Krótkie zdanie. ', longSentence];
    const text = sentences.join('');
    expect(text.length).toBeGreaterThan(Array.from(text).length);
    expect(longSentence.length).toBeGreaterThan(900);

    const step = createSentencexSegmentStep(() => codePointBoundaries(sentences));
    const result = step(makeCtx(text));

    expect(result.segments.length).toBeGreaterThan(2);
    assertSliceInvariant(text, result.segments);
  });
});
