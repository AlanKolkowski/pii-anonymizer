import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findRegexEntities, deduplicateEntities } from '../../src/anonymizer.js';
import { containsToken } from '../../src/tokens.js';
import { resolveOccurrences } from '../../src/substitution.js';
import { TOOL_CATALOG } from '../../src/mcp/tool-catalog.js';

// MOST-IMPL-PLAN.md R-3: the packaged bridge variant (B) ships app.asar
// WITHOUT src/** except a closed five-file list re-added explicitly:
//   src/anonymizer.js, src/tokens.js, src/substitution.js,
//   src/pipeline/data/identifier-patterns.json, src/mcp/tool-catalog.js
// The plan's own precondition for that list being safe: this import graph
// never reaches outside itself and never touches DOM/window ("łańcuch
// importów tych pięciu plików nie może wyjść poza tę listę ani dotknąć
// DOM/window — dziś tak jest (zmierzone)"). This file is the standing
// measurement — a static check of the import graph, plus a dynamic smoke
// check that each module loads and runs in bare Node. This test file itself
// runs under vitest's default 'node' environment (no jsdom pragma), so a
// reference to `document`/`window` in the exercised code path would throw
// instead of silently working.

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readSrc(relPath) {
  return readFileSync(REPO_ROOT + relPath, 'utf8');
}

// Matches `import ... from '...'`, including the `with { type: 'json' }`
// import-assertion form anonymizer.js uses for identifier-patterns.json.
// Deliberately a simple, literal regex (mirroring the house style of the
// existing grep-based net-invariant tests) rather than a full JS parser —
// these five files' import style is plain and stable enough for that.
const IMPORT_RE = /^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;

function importSpecifiers(source) {
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1]);
}

describe('R-3 closed import list — static graph', () => {
  it('anonymizer.js imports only tokens.js, substitution.js and the identifier-patterns JSON', () => {
    const specifiers = importSpecifiers(readSrc('src/anonymizer.js'));
    expect(specifiers.slice().sort()).toEqual([
      './pipeline/data/identifier-patterns.json',
      './substitution.js',
      './tokens.js',
    ]);
  });

  it('substitution.js imports only tokens.js', () => {
    expect(importSpecifiers(readSrc('src/substitution.js'))).toEqual(['./tokens.js']);
  });

  it('tokens.js has zero imports (pure, per its own header comment)', () => {
    expect(importSpecifiers(readSrc('src/tokens.js'))).toEqual([]);
  });

  it('tool-catalog.js has zero imports (pure data)', () => {
    expect(importSpecifiers(readSrc('src/mcp/tool-catalog.js'))).toEqual([]);
  });

  it.each([
    'src/anonymizer.js',
    'src/tokens.js',
    'src/substitution.js',
    'src/mcp/tool-catalog.js',
  ])('%s never references document./window. as a DOM global (DOM-free, packageable into the bridge asar)', (relPath) => {
    // Property-access shape only (`window.foo`, `document.foo`) — not a bare
    // `\bwindow\./\bdocument\.` match, which also fires on ordinary English
    // prose in comments ("...sits in the preceding window.", full stop).
    const source = readSrc(relPath);
    expect(source).not.toMatch(/\bdocument\.[A-Za-z_]/);
    expect(source).not.toMatch(/\bwindow\.[A-Za-z_]/);
  });
});

describe('R-3 closed import list — dynamic smoke (loads and runs in bare Node)', () => {
  it('findRegexEntities + deduplicateEntities run without any DOM/window present', () => {
    const text = 'e-mail: a@b.pl';
    const entities = deduplicateEntities(findRegexEntities(text), text);
    expect(entities).toEqual([expect.objectContaining({ entity_group: 'EMAIL_ADDRESS' })]);
  });

  it('containsToken runs without any DOM/window present', () => {
    expect(containsToken('[PERSON_NAME_1]')).toBe(true);
    expect(containsToken('zwykły tekst')).toBe(false);
  });

  it('resolveOccurrences (substitution.js) runs without any DOM/window present', () => {
    expect(() => resolveOccurrences('[PERSON_NAME_1]', { legend: {} })).not.toThrow();
  });

  it('TOOL_CATALOG loads as plain frozen data with no DOM/window present', () => {
    expect(TOOL_CATALOG).toHaveLength(5);
  });
});
