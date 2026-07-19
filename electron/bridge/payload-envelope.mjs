// "Shown = sent" construction (MCP-BRIDGE-DESIGN.md §6.8, MOST-IMPL-PLAN.md
// §4 / O-9). The requirement: the gate window must display EXACTLY the
// bytes that later cross the pipe as the tool result — zero trim, zero
// reformatting, zero line-ending normalization between "shown" and "sent".
//
// This module is the shared construction every view of a payload must go
// through: build the wire frame once, extract from it, render it to the DOM
// once. It does not itself open a window or a socket — gate-window/gate.js
// (BUILD phase, needs Electron) will call renderTextContent on the real
// preview element, and mcp-stdio.mjs calls buildResultFrame when a decision
// approves a payload. Keeping the construction here, independent of both,
// is what makes it testable without either.
//
// The real end-to-end proof (O-9/G-M-6) captures three points on a PACKAGED
// binary via CDP: window.getPayload(), the preview element's textContent,
// and the actual pipe frame — that is a BUILD-phase task (M8). What's
// laptop-safe and done here: proving the construction itself introduces no
// transformation, via the same hash-equality check applied to this module's
// three views in isolation (payload-envelope.test.js).

import { createHash } from 'node:crypto';

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Wire shape exactly as specified (MCP-BRIDGE-DESIGN.md §3 M2 frame table):
//   G→A: { "t": "result", "reqId": "r1", "result": { "content": [...], "isError": false } }
// `content` always has exactly one text element — MOST-IMPL-PLAN.md §3 M4
// "Walidacja kształtu wyniku": one element, no extra fields.
export function buildResultFrame(reqId, text, { isError = false } = {}) {
  return { t: 'result', reqId, result: { content: [{ type: 'text', text }], isError } };
}

// Inverse of buildResultFrame. Deliberately strict: a shape that doesn't
// match exactly throws rather than returning undefined/guessing, because
// every caller of this function is on the "did the bytes survive intact"
// critical path (the M8 hash-equality test, and eventually the fake stdio
// client in e2e/desktop-bridge-smoke.mjs) — a silent undefined here would
// quietly turn a real corruption into a passing test.
export function extractFrameText(frame) {
  const text = frame?.result?.content?.[0]?.text;
  if (typeof text !== 'string' || frame.result.content.length !== 1) {
    throw new Error('malformed result frame: expected exactly one content[0].text string');
  }
  return text;
}

// Renders `text` into `domNode` via `.textContent` only — never innerHTML
// (C-INP-1, mirrors the rest of the app's rendering discipline). Returns the
// node's textContent right back so a caller/test can hash what the DOM
// actually holds rather than trusting the input was stored unchanged.
export function renderTextContent(domNode, text) {
  domNode.textContent = text;
  return domNode.textContent;
}
