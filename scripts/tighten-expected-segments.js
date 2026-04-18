import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOCS_DIR = join(import.meta.dirname, '..', 'test-data', 'synthetic');

const HAS_CONTENT = /[\p{L}\p{N}]/u;

/**
 * Tighten a segment by:
 *  - Dropping leading and trailing lines that contain no letters/digits
 *    (internal noise lines are preserved to keep surrounding context).
 *  - Trimming leading whitespace on the first kept line and trailing
 *    whitespace on the last kept line.
 *  - Adjusting start/end so `text === source.slice(start, end)` still holds.
 *
 * Returns `null` if the segment has no content lines at all.
 */
function tightenSegment(seg) {
  const text = seg.text;
  const lines = [];
  let pos = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      lines.push({ start: pos, end: i, text: text.slice(pos, i) });
      pos = i + 1;
    }
  }

  const firstIdx = lines.findIndex(l => HAS_CONTENT.test(l.text));
  if (firstIdx === -1) return null;
  let lastIdx = lines.length - 1;
  while (lastIdx > firstIdx && !HAS_CONTENT.test(lines[lastIdx].text)) lastIdx--;

  const first = lines[firstIdx];
  const last = lines[lastIdx];
  const leading = first.text.length - first.text.trimStart().length;
  const trailing = last.text.length - last.text.trimEnd().length;
  const startLocal = first.start + leading;
  const endLocal = last.end - trailing;

  return {
    start: seg.start + startLocal,
    end: seg.start + endLocal,
    text: text.slice(startLocal, endLocal),
  };
}

async function processFile(file) {
  const path = join(DOCS_DIR, file);
  const segs = JSON.parse(await readFile(path, 'utf-8'));

  let changed = 0, dropped = 0;
  const out = [];
  for (const s of segs) {
    const t = tightenSegment(s);
    if (!t) { dropped++; continue; }
    if (t.text !== s.text) changed++;
    out.push(t);
  }

  await writeFile(path, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`  ${file}: ${segs.length} → ${out.length} segs (${changed} changed, ${dropped} dropped)`);
}

async function main() {
  const entries = await readdir(DOCS_DIR);
  const files = entries.filter(f => f.endsWith('.expected-segments.json')).sort();
  for (const f of files) await processFile(f);
}

main().catch((err) => {
  console.error('tighten-expected-segments failed:', err);
  process.exit(1);
});
