import { serializeFrame, createFrameParser } from './framing.mjs';

// MOST-IMPL-PLAN.md §3 M2: NDJSON framing shared by every line-based
// transport in the bridge — the adapter's stdio side (mcp-stdio.mjs, built
// in this change) today, and the `\\.\pipe\` transport later (pipe-server/
// pipe-client, a BUILD-phase task). P-5: JSON.stringify already guarantees
// no raw newline survives inside a serialized frame, so serialization needs
// no custom escaping — only the streaming parser is nontrivial (partial
// lines across chunk boundaries, a size limit, tolerance for one bad line).

describe('serializeFrame', () => {
  it('is JSON.stringify + a trailing newline, with no other transformation', () => {
    const frame = { t: 'hello', nonceS: 'abc' };
    expect(serializeFrame(frame)).toBe(JSON.stringify(frame) + '\n');
  });

  it('never lets an embedded newline in payload text produce a raw newline in the frame (P-5)', () => {
    const frame = { t: 'result', text: 'line one\nline two' };
    const serialized = serializeFrame(frame);
    // exactly one raw newline: the frame terminator itself
    expect(serialized.match(/\n/g)).toHaveLength(1);
    expect(serialized.endsWith('\n')).toBe(true);
  });
});

describe('createFrameParser', () => {
  it('parses a single frame delivered in one chunk', () => {
    const frames = [];
    const parser = createFrameParser({ onFrame: (f) => frames.push(f) });
    parser.push(serializeFrame({ a: 1 }));
    expect(frames).toEqual([{ a: 1 }]);
  });

  it('parses multiple frames delivered in one chunk', () => {
    const frames = [];
    const parser = createFrameParser({ onFrame: (f) => frames.push(f) });
    parser.push(serializeFrame({ a: 1 }) + serializeFrame({ a: 2 }) + serializeFrame({ a: 3 }));
    expect(frames).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('parses a single frame split across two chunks (partial line buffering)', () => {
    const frames = [];
    const parser = createFrameParser({ onFrame: (f) => frames.push(f) });
    const whole = serializeFrame({ hello: 'world' });
    const splitAt = Math.floor(whole.length / 2);
    parser.push(whole.slice(0, splitAt));
    expect(frames).toEqual([]); // nothing yet -- no newline seen
    parser.push(whole.slice(splitAt));
    expect(frames).toEqual([{ hello: 'world' }]);
  });

  it('reports an error for a line that is not valid JSON, without throwing, and keeps parsing subsequent lines', () => {
    const frames = [];
    const errors = [];
    const parser = createFrameParser({ onFrame: (f) => frames.push(f), onError: (e) => errors.push(e) });
    expect(() => parser.push('not json at all\n' + serializeFrame({ ok: true }))).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(frames).toEqual([{ ok: true }]);
  });

  it('ignores blank lines without calling onFrame or onError', () => {
    const frames = [];
    const errors = [];
    const parser = createFrameParser({ onFrame: (f) => frames.push(f), onError: (e) => errors.push(e) });
    parser.push('\n\n' + serializeFrame({ a: 1 }));
    expect(frames).toEqual([{ a: 1 }]);
    expect(errors).toEqual([]);
  });

  it('rejects a single line exceeding maxFrameBytes and never calls onFrame for it', () => {
    const frames = [];
    const errors = [];
    const parser = createFrameParser({ maxFrameBytes: 16, onFrame: (f) => frames.push(f), onError: (e) => errors.push(e) });
    const hugeLine = 'x'.repeat(100) + '\n';
    parser.push(hugeLine);
    expect(frames).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('guards against an ever-growing buffer when no newline ever arrives (DoS floor)', () => {
    const errors = [];
    const parser = createFrameParser({ maxFrameBytes: 16, onError: (e) => errors.push(e) });
    expect(() => parser.push('x'.repeat(1000))).not.toThrow(); // no newline in this chunk at all
    expect(errors.length).toBeGreaterThan(0);
  });
});
