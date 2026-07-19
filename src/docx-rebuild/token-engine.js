// Token engine (DOCX-REBUILD-DESIGN.md MD4, §4): the ONLY consumer of the
// legend in the rebuild flow. Per part: paragraph text stream + segment map
// over `w:t` nodes, literal token matching by the shared grammar
// (src/tokens.js — the single grammar, O-4), replacement plan applied in one
// pass, first-run-wins formatting (§4.4), xml:space hygiene and value
// sanitization (§4.6), residue scan for the report (§6.2).
//
// Fail-safe by construction (§6.1): the only content-changing operation is
// replacing the exact literal of a token PRESENT in the legend. A token
// broken by a hard element (sentinel), unknown to the legend, or living in a
// report-only stream stays visible and is reported — never guessed.
//
// Values from the legend come from untrusted source documents (Z3/S-DOCX-4):
// they enter the XML exclusively as DOM text node content — the serializer
// escapes; no string-XML splicing exists anywhere in this module (O-3).

import { findTokens } from '../tokens.js';
import { parseXmlPart } from './ooxml-inspect.js';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

// U+FFFC OBJECT REPLACEMENT CHARACTER — outside the token grammar, so no
// match can ever cross a hard boundary (§4.2 pkt 4).
export const SENTINEL = '￼';

// Elements that break the text stream (§4.2 pkt 4). Their subtrees are not
// descended into — their content is not paragraph text.
const SENTINEL_ELEMENTS = new Set([
  'br', 'cr', 'tab', 'sym', 'noBreakHyphen', 'softHyphen',
  'drawing', 'pict', 'object', 'fldChar',
  'footnoteReference', 'endnoteReference', 'commentReference',
]);

// Excluded from the replacement stream (§4.2 pkt 5) but scanned for the
// report: field instructions and tracked-changes deletions.
const EXCLUDED_TEXT_ELEMENTS = new Set(['instrText', 'delText']);

const CONTEXT_RADIUS = 40;

function isW(node, localName) {
  return node.namespaceURI === W_NS && node.localName === localName;
}

function nearestParagraph(node) {
  for (let cur = node.parentNode; cur; cur = cur.parentNode) {
    if (isW(cur, 'p')) return cur;
  }
  return null;
}

// Builds the paragraph stream S and the segment map (§4.2). `collect`
// decides which text lands in S: the replacement stream excludes
// instrText/delText (sentinel instead); the report streams include them.
function paragraphStream(paragraph, { includeExcluded = false } = {}) {
  const segments = [];
  let stream = '';
  const excluded = [];

  const visit = (node) => {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    if (node !== paragraph && isW(node, 'p')) return; // nested txbx paragraph — its own unit
    if (node.namespaceURI === W_NS && SENTINEL_ELEMENTS.has(node.localName)) {
      stream += SENTINEL;
      return;
    }
    if (node.namespaceURI === W_NS && EXCLUDED_TEXT_ELEMENTS.has(node.localName)) {
      if (includeExcluded) excluded.push({ kind: node.localName, text: node.textContent });
      stream += SENTINEL;
      return;
    }
    if (isW(node, 't') && nearestParagraph(node) === paragraph) {
      segments.push({ node, start: stream.length, length: node.textContent.length });
      stream += node.textContent;
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  for (let child = paragraph.firstChild; child; child = child.nextSibling) visit(child);

  return { stream, segments, excluded };
}

// §4.6: control characters (C0 except \t) and raw line breaks have no
// defined semantics inside w:t — normalized to a single space and counted.
export function sanitizeValue(value) {
  let sanitized = 0;
  const controlChars = new RegExp('[\u0000-\u0008\u000B-\u001F\u007F\r\n]', 'g');
  const text = value.replace(controlChars, () => {
    sanitized += 1;
    return ' ';
  });
  return { text, sanitized };
}

function contextAround(stream, start, end) {
  const from = Math.max(0, start - CONTEXT_RADIUS);
  const to = Math.min(stream.length, end + CONTEXT_RADIUS);
  return `${from > 0 ? '…' : ''}${stream.slice(from, to).replaceAll(SENTINEL, '¶')}${to < stream.length ? '…' : ''}`;
}

// A token opener that the grammar did NOT match — usually a token torn apart
// by a hard element (the sentinel sits inside what would have been the
// literal). Reported as 'przerwany-elementem'; anything else malformed falls
// out as 'brak-w-legendzie' via the grammar scan.
function findBrokenTokenResidues(stream, matchedIndexes) {
  const residues = [];
  for (const m of stream.matchAll(/\[[A-Z][A-Z0-9_]*/g)) {
    if (matchedIndexes.has(m.index)) continue;
    const lookahead = stream.slice(m.index, m.index + 64);
    const closing = lookahead.indexOf(']');
    const sentinel = lookahead.indexOf(SENTINEL);
    if (sentinel !== -1 && (closing === -1 || sentinel < closing)) {
      residues.push({
        token: m[0],
        reason: 'przerwany-elementem',
        context: contextAround(stream, m.index, m.index + m[0].length),
      });
    }
  }
  return residues;
}

function newTextForSegment(segment, matches, stream) {
  const segEnd = segment.start + segment.length;
  let out = '';
  let pos = segment.start;
  for (const match of matches) {
    const mStart = match.index;
    const mEnd = match.index + match.rawLength;
    if (mEnd <= segment.start || mStart >= segEnd) continue;
    if (mStart > pos) out += stream.slice(pos, Math.min(mStart, segEnd));
    if (mStart >= segment.start) out += match.value; // §4.4: value lands in the segment the token STARTS in
    pos = Math.min(Math.max(mEnd, pos), segEnd);
  }
  if (pos < segEnd) out += stream.slice(pos, segEnd);
  return out;
}

/**
 * Rebuilds one XML part (§4). Returns the replacement outcome; `xml` is null
 * when not a single replacement happened — the caller then keeps the part's
 * original compressed bytes verbatim (§3.3 invariant).
 *
 * @param {object} params
 * @param {string} params.xmlText - the part's XML source
 * @param {string} params.partName
 * @param {object} params.legend - token → base value (read at export time, RAM only)
 * @param {Function} [params.resolveReplacement] - the flexion seam
 *   (DOCX-IMPL-PLAN.md FD-1, §8 of the parent design). Called only for
 *   occurrences with a legend value, as:
 *   `resolveReplacement({ token, tokenId, type, baseValue, case, contextBefore,
 *   contextAfter, occurrence, part }) -> { text, note? } | undefined`.
 *   A refusal (`undefined` — including "no resolver at all", since the call
 *   itself is skipped then) falls back to `baseValue`, NEVER throws (FD-1
 *   pt 0 — the historic bug this contract closes). Pure and local by
 *   contract; its output passes the same §4.6 sanitization as the base
 *   value. `occurrence` is a per-PART counter, left to right in document
 *   order, over ELIGIBLE (legend-having) occurrences only — v1 report scope
 *   only (§3.2 point 3); binding to a global text-preview enumeration is
 *   FL-7, out of this plan.
 */
export function rebuildPart({ xmlText, partName, legend, resolveReplacement = null }) {
  const doc = parseXmlPart(xmlText, partName);

  const replacedCounts = new Map();
  const left = [];
  const declined = [];
  const reportOnlyTokens = { instrText: 0, delText: 0 };
  let sanitizedTotal = 0;
  let anyReplacement = false;
  let flexionDeclinedCount = 0;
  let occurrence = 0;

  const paragraphs = [...doc.getElementsByTagNameNS(W_NS, 'p')];
  for (const paragraph of paragraphs) {
    const { stream, segments, excluded } = paragraphStream(paragraph, { includeExcluded: true });
    for (const { kind, text } of excluded) {
      const hits = findTokens(text).length;
      if (kind === 'instrText') reportOnlyTokens.instrText += hits;
      else reportOnlyTokens.delText += hits;
    }
    if (!stream.includes('[')) continue;

    const matches = [];
    for (const token of findTokens(stream)) {
      const baseValue = legend[token.token];
      if (baseValue === undefined) continue; // reported by the post-scan below
      // FD-1: resolveReplacement is invoked ONLY when provided — `?.()`
      // yields `undefined` either way (no resolver, or a real refusal), so
      // both collapse to the same fallback below with no special-casing.
      const resolved = resolveReplacement?.({
        token: token.token,
        tokenId: token.tokenId,
        type: token.type,
        baseValue,
        case: token.case,
        contextBefore: stream.slice(Math.max(0, token.index - CONTEXT_RADIUS), token.index),
        contextAfter: stream.slice(token.index + token.rawLength, token.index + token.rawLength + CONTEXT_RADIUS),
        occurrence: occurrence++,
        part: partName,
      });
      if (resolveReplacement && token.type === 'PERSON_NAME' && resolved === undefined) {
        flexionDeclinedCount += 1;
      }
      // FD-1 pt 0 (the crash this delta closes): a resolver refusal is
      // `undefined` per contract — `resolved?.text` never throws, and falls
      // back to the base value exactly like having no resolver at all
      // (aligned to substitution.js's `resolved?.text ?? baseValue`).
      const { text: value, sanitized } = sanitizeValue(resolved?.text ?? baseValue);
      sanitizedTotal += sanitized;
      matches.push({ index: token.index, rawLength: token.rawLength, value, token: token.token });
      // FD-2: a row for every substitution whose FILE value differs from the
      // base (after sanitization) — the report can never disagree with what
      // actually landed in the part (R-D6). Metadata comes from the
      // resolver's own `note` (FD-4); never invented by this engine.
      if (value !== baseValue) {
        declined.push({
          token: token.token,
          z: baseValue,
          na: value,
          przypadek: resolved?.note?.przypadek,
          zrodlo: resolved?.note?.zrodlo,
          pewnosc: resolved?.note?.pewnosc,
          part: partName,
        });
      }
    }

    if (matches.length > 0) {
      for (const segment of segments) {
        const affected = matches.some((m) =>
          m.index < segment.start + segment.length && m.index + m.rawLength > segment.start);
        if (!affected) continue;
        const nextText = newTextForSegment(segment, matches, stream);
        // Values enter as text node content ONLY (O-3) — textContent replaces
        // children with a single text node; the serializer escapes on write.
        segment.node.textContent = nextText;
        if (/^\s|\s$/.test(nextText) && !segment.node.getAttributeNS(XML_NS, 'space')) {
          segment.node.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        }
      }
      for (const match of matches) {
        replacedCounts.set(match.token, (replacedCounts.get(match.token) ?? 0) + 1);
        anyReplacement = true;
      }
    }

    // §6.2: the residue scan runs AFTER replacement, over the part's actual
    // final stream — so the report can never disagree with the file. Every
    // grammar hit that survived is a residue: a token unknown to the legend,
    // or a legend-token literal that arrived INSIDE an inserted value (the
    // one-pass rule §4.5 rightly never replaces those — no cascade — but the
    // user must still see it in the map).
    const postStream = matches.length > 0 ? paragraphStream(paragraph).stream : stream;
    const postMatchedIndexes = new Set();
    for (const token of findTokens(postStream)) {
      postMatchedIndexes.add(token.index);
      left.push({
        token: token.token,
        reason: token.token in legend ? 'literał-w-wartości' : 'brak-w-legendzie',
        context: contextAround(postStream, token.index, token.index + token.rawLength),
      });
    }
    left.push(...findBrokenTokenResidues(postStream, postMatchedIndexes));
  }

  let xml = null;
  if (anyReplacement) {
    const serialized = new XMLSerializer().serializeToString(doc);
    const declaration = /^<\?xml[^>]*\?>\s*/.exec(xmlText)?.[0] ?? '';
    xml = declaration && !serialized.startsWith('<?xml') ? declaration + serialized : serialized;
  }

  return {
    changed: anyReplacement,
    xml,
    replaced: [...replacedCounts.entries()].map(([token, count]) => ({ token, count })),
    left,
    declined,
    flexionDeclinedCount,
    reportOnlyTokens,
    sanitized: sanitizedTotal,
  };
}

// Report-only token count for a whole part (comments in v1, §5.1) — every
// text stream including field instructions and deleted text.
export function countTokensInPart(xmlText, partName) {
  const doc = parseXmlPart(xmlText, partName);
  let count = 0;
  for (const paragraph of doc.getElementsByTagNameNS(W_NS, 'p')) {
    const { stream, excluded } = paragraphStream(paragraph, { includeExcluded: true });
    count += findTokens(stream).length;
    for (const { text } of excluded) count += findTokens(text).length;
  }
  return count;
}
