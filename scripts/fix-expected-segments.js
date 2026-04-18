import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const DOCS_DIR = join(import.meta.dirname, '..', 'test-data', 'synthetic');

// List marker at line start: "- ", or "N.", "N)" (with optional leading whitespace already stripped)
const LIST_MARKER = /^(?:[-–—•*]\s|\d+[.)]\s)/;

function isSentenceEnd(ch) {
  return ch === '.' || ch === '!' || ch === '?';
}

function isWhitespaceOnly(s) {
  return s.replace(/\s/g, '').length === 0;
}

/**
 * Given a segment's text (with absolute `start` offset into source), return
 * split points as array of { start, end, text } substrings.
 *
 * We split at every newline where:
 *   (a) the character immediately before the newline is sentence-terminating, AND
 *       the content after the newline (after stripping leading whitespace)
 *       starts either a list marker or a capital letter / digit, OR
 *   (b) the content after the newline (after stripping leading whitespace)
 *       starts with a list marker.
 */
function splitSegment(seg) {
  const text = seg.text;
  const baseStart = seg.start;
  const cuts = [0];

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n') continue;

    // Look back to the last non-whitespace char (within this segment)
    let j = i - 1;
    while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
    const prevCh = j >= 0 ? text[j] : '';

    // Look forward to first non-whitespace char after the newline
    let k = i + 1;
    while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n')) k++;
    if (k >= text.length) continue;
    const after = text.slice(k);
    const isListAfter = LIST_MARKER.test(after);

    const sentenceEndBefore = isSentenceEnd(prevCh);

    if (isListAfter || (sentenceEndBefore && after.length > 0)) {
      // Cut at k — so preceding chunk keeps its trailing whitespace/newlines,
      // and new chunk starts with the list marker / first real char.
      // But we actually want split at the newline so the \n stays with the
      // preceding chunk. Splitting at i+1 keeps the \n with previous chunk.
      // However if there are multiple \n in a row (blank line), we want to
      // cut the last \n so blank line becomes a separator chunk that we
      // might drop later if whitespace-only.
      if (cuts[cuts.length - 1] !== i + 1) cuts.push(i + 1);
    }
  }
  cuts.push(text.length);

  const out = [];
  for (let c = 0; c < cuts.length - 1; c++) {
    const from = cuts[c];
    const to = cuts[c + 1];
    if (to <= from) continue;
    const chunk = text.slice(from, to);
    out.push({
      start: baseStart + from,
      end: baseStart + to,
      text: chunk,
    });
  }
  return out;
}

async function processFile(file) {
  const segPath = join(DOCS_DIR, file);
  const segs = JSON.parse(await readFile(segPath, 'utf-8'));

  const out = [];
  let splits = 0;
  let dropped = 0;
  for (const s of segs) {
    const pieces = splitSegment(s);
    for (const p of pieces) {
      if (isWhitespaceOnly(p.text)) {
        dropped++;
        continue;
      }
      out.push(p);
    }
    if (pieces.length > 1) splits++;
  }

  await writeFile(segPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`  ${file}: ${segs.length} → ${out.length} segs (${splits} split, ${dropped} dropped)`);
}

async function main() {
  const entries = await readdir(DOCS_DIR);
  const files = entries.filter(f => f.endsWith('.expected-segments.json')).sort();
  for (const f of files) {
    await processFile(f);
  }
}

main().catch((err) => {
  console.error('fix-expected-segments failed:', err);
  process.exit(1);
});
