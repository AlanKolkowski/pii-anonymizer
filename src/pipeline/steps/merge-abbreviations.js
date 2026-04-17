import { CAT_A, CAT_B } from '../data/polish-abbreviations.js';

const LIST_MARKER_RE = /^(\d+|[IVXLCDM]+|[a-z])\.$/;
const TRAILING_LIST_MARKER_RE = /(?:^|\n)\s*(?:\d+|[IVXLCDM]+|[a-z]|§\s*\d+)\.\s*$/;
const PARAGRAPH_BREAK_RE = /\n\s*\n/;
const MAX_SUFFIX_WORDS = 3;

function isListMarker(segText) {
  return LIST_MARKER_RE.test(segText.trim());
}

function endsWithListMarker(segText) {
  return TRAILING_LIST_MARKER_RE.test(segText);
}

function hasParagraphBreakBetween(prev, next, originalText) {
  const start = prev.offset + prev.text.length;
  const end = next.offset;
  if (end <= start) return false;
  return PARAGRAPH_BREAK_RE.test(originalText.slice(start, end));
}

function matchDictionarySuffix(segText) {
  const trimmed = segText.trimEnd();
  const words = trimmed.split(/\s+/);
  for (let n = Math.min(MAX_SUFFIX_WORDS, words.length); n >= 1; n--) {
    const candidate = words.slice(words.length - n).join(' ').toLowerCase();
    if (CAT_A.has(candidate)) return 'A';
    if (CAT_B.has(candidate)) return 'B';
  }
  return null;
}

function sliceMerged(originalText, segA, segB) {
  const start = segA.offset;
  const end = segB.offset + segB.text.length;
  return { text: originalText.slice(start, end), offset: start };
}

const LOWERCASE_POLISH_RE = /[a-ząćęłńóśźż]/;
const DIGIT_RE = /[0-9]/;
const CONTINUATION_PUNCT_RE = /[:,(\-–—/]/;

function firstNonWhitespaceChar(s) {
  const trimmed = s.trimStart();
  return trimmed.length > 0 ? trimmed[0] : '';
}

function startsWithLowercaseOrDigit(s) {
  const ch = firstNonWhitespaceChar(s);
  return LOWERCASE_POLISH_RE.test(ch) || DIGIT_RE.test(ch);
}

function startsWithContinuation(s) {
  const ch = firstNonWhitespaceChar(s);
  if (!ch) return false;
  return (
    LOWERCASE_POLISH_RE.test(ch) ||
    DIGIT_RE.test(ch) ||
    CONTINUATION_PUNCT_RE.test(ch)
  );
}

const WORD_DOT_END_RE = /\w\.\s*$/u;

function endsWithWordDot(segText) {
  return WORD_DOT_END_RE.test(segText);
}

const SINGLE_UPPER_DOT_END_RE = /(?:^|[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])[A-ZĄĆĘŁŃÓŚŹŻ]\.\s*$/u;
const SINGLE_UPPER_DOT_START_RE = /^\s*[A-ZĄĆĘŁŃÓŚŹŻ]\.(?:[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]|$)/u;
const INITIAL_AFTER_DASH_END_RE = /[–—-]\s+[A-ZĄĆĘŁŃÓŚŹŻ]\.\s*$/u;
const UPPERCASE_WORD_START_RE = /^\s*[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]/u;

function endsWithSingleUpperDot(s) {
  return SINGLE_UPPER_DOT_END_RE.test(s);
}

function startsWithSingleUpperDot(s) {
  return SINGLE_UPPER_DOT_START_RE.test(s);
}

function endsWithInitialAfterDash(s) {
  return INITIAL_AFTER_DASH_END_RE.test(s);
}

function startsWithUppercaseWord(s) {
  return UPPERCASE_WORD_START_RE.test(s);
}

function shouldMerge(prev, next, originalText) {
  if (hasParagraphBreakBetween(prev, next, originalText)) return null;
  if (isListMarker(prev.text)) return 'R3';
  if (endsWithListMarker(prev.text)) return 'R3';
  const cat = matchDictionarySuffix(prev.text);
  if (cat === 'A') return 'R1a';
  if (cat === 'B' && startsWithContinuation(next.text)) return 'R1b';
  if (endsWithSingleUpperDot(prev.text) && startsWithSingleUpperDot(next.text)) return 'R4';
  if (endsWithInitialAfterDash(prev.text) && startsWithUppercaseWord(next.text)) return 'R5';
  if (endsWithWordDot(prev.text) && startsWithContinuation(next.text)) return 'R2';
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
