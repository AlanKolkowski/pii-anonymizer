import { readFile } from 'node:fs/promises';

// Canonical eval-text convention: LF line endings, offsets in UTF-16 code
// units. Ground truth in test-data/**/*.expected.json is annotated against
// the repo-canonical (LF) content, but a Windows checkout with
// core.autocrlf=true materializes CRLF in the working tree — reading raw
// bytes there shifts every offset by +1 per preceding newline and zeroes
// every score (see EVAL-RECALL-AUDIT.md). Every eval reader must go through
// readEvalText, and every run is stamped with EVAL_TEXT_CONVENTION so that
// score.js can refuse to score runs produced under a different convention.
export const EVAL_TEXT_CONVENTION = 'lf-utf16-v1';

export function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function readEvalText(path) {
  return normalizeEol(await readFile(path, 'utf-8'));
}

// Checks that each expected entity's [start, end) slice of `text` equals its
// `text` field. Returns a list of mismatches; empty list = offsets valid.
export function validateExpectedOffsets(expected, text) {
  const mismatches = [];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const actual = text.slice(e.start, e.end);
    if (actual !== e.text) {
      mismatches.push({ index: i, entity: e, actual });
    }
  }
  return mismatches;
}

export function formatOffsetMismatches(docName, mismatches, limit = 5) {
  const lines = [
    `${docName}: ${mismatches.length} expected entities do not match the text at their offsets`,
  ];
  for (const m of mismatches.slice(0, limit)) {
    lines.push(
      `  [${m.entity.start}:${m.entity.end}] expected ${JSON.stringify(m.entity.text)} got ${JSON.stringify(m.actual)}`,
    );
  }
  if (mismatches.length > limit) {
    lines.push(`  … and ${mismatches.length - limit} more`);
  }
  return lines.join('\n');
}
