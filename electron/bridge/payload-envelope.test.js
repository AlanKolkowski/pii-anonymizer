// @vitest-environment jsdom
import { sha256Hex, buildResultFrame, extractFrameText, renderTextContent } from './payload-envelope.mjs';

// MCP-BRIDGE-DESIGN.md §6.8 / MOST-IMPL-PLAN.md §4 — "pokazane = wysłane"
// (shown = sent): the gate window must show EXACTLY the bytes that end up on
// the wire, with zero trim/reformat/re-encoding in between. The full product
// proof (O-9/G-M-6) runs on a packaged binary via CDP, reading (a) the real
// gate window's getPayload(), (b) its rendered DOM textContent, and (c) the
// actual pipe frame — that three-point capture is a BUILD-phase task (M8).
//
// What's laptop-safe and proven here instead: the CONSTRUCTION every one of
// those three views is built from. If sha256(original) === sha256(DOM view)
// === sha256(wire-frame view) for a payload engineered to stress every
// transformation that could silently corrupt it (embedded newline, quotes,
// backslash, unicode, an anonymization token), then there is no
// trim/reformat/normalization hiding anywhere in this code path — the same
// guarantee the real 3-point CDP test checks, minus the real window.
const TRICKY_PAYLOAD = [
  'Klient [PERSON_NAME_1] – PESEL [PERSON_IDENTIFIER_1].',
  'Adres: ul. Piekary 33, "II piętro" (cudzysłów), 87-100 Toruń.',
  'Ścieżka: C:\\Program Files\\Lokalny anonimizator + AI\\',
  'Ogonki: ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ — em-dash i unicode.',
].join('\n');

describe('sha256Hex', () => {
  it('is deterministic and sensitive to every byte', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildResultFrame / extractFrameText round-trip', () => {
  it('matches the M2 wire schema exactly', () => {
    const frame = buildResultFrame('r1', 'hello');
    expect(frame).toEqual({
      t: 'result',
      reqId: 'r1',
      result: { content: [{ type: 'text', text: 'hello' }], isError: false },
    });
  });

  it('supports the isError variant', () => {
    const frame = buildResultFrame('r1', 'Użytkownik odmówił.', { isError: true });
    expect(frame.result.isError).toBe(true);
  });

  it('round-trips arbitrary payload text through JSON.stringify/parse losslessly (P-5: JSON escapes, never mutates)', () => {
    const frame = buildResultFrame('r7', TRICKY_PAYLOAD);
    const wire = JSON.stringify(frame);
    expect(wire).not.toMatch(/[^\\]\n/); // no raw newline inside the JSON text
    const roundTripped = extractFrameText(JSON.parse(wire));
    expect(roundTripped).toBe(TRICKY_PAYLOAD);
  });

  it('extractFrameText rejects a frame that does not match the exact shape (defence in depth, never guesses)', () => {
    expect(() => extractFrameText({ t: 'result', result: {} })).toThrow();
    expect(() => extractFrameText({ t: 'result', result: { content: [] } })).toThrow();
    expect(() => extractFrameText(null)).toThrow();
  });
});

describe('renderTextContent (C-INP-1: textContent only, never innerHTML)', () => {
  it('assigns via .textContent and reads back the exact same string, including markup-looking content', () => {
    const node = document.createElement('pre');
    const withMarkup = `${TRICKY_PAYLOAD}\n<img src=x onerror=alert(1)> & "quoted" 'stuff'`;
    const readBack = renderTextContent(node, withMarkup);
    expect(readBack).toBe(withMarkup);
    expect(node.textContent).toBe(withMarkup);
    // Proof it never touched innerHTML: the "tag" is inert text, not a
    // child element (jsdom would have created an <img> node otherwise).
    expect(node.querySelector('img')).toBeNull();
    expect(node.childNodes).toHaveLength(1);
    expect(node.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });
});

describe('three-point hash equality ("shown = sent" construction proof)', () => {
  it('sha256(original) === sha256(DOM view) === sha256(wire-frame view)', () => {
    const original = TRICKY_PAYLOAD;

    const node = document.createElement('pre');
    const domView = renderTextContent(node, original);

    const frame = buildResultFrame('r-hash', original);
    const wireView = extractFrameText(JSON.parse(JSON.stringify(frame)));

    const hashOriginal = sha256Hex(original);
    const hashDom = sha256Hex(domView);
    const hashWire = sha256Hex(wireView);

    expect(hashDom).toBe(hashOriginal);
    expect(hashWire).toBe(hashOriginal);
  });

  it('is sensitive enough to catch a one-character corruption (sanity check on the test itself)', () => {
    const corrupted = TRICKY_PAYLOAD.replace('Toruń', 'Torun');
    expect(sha256Hex(corrupted)).not.toBe(sha256Hex(TRICKY_PAYLOAD));
  });
});
