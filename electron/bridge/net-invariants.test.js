import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// MCP-BRIDGE-DESIGN.md §4.6 (C-NET-6b) / MOST-IMPL-PLAN.md C-BR-2/C-BR-3:
// in the finished bridge, `node:net` is allowed ONLY in
// electron/bridge/pipe-server.mjs and pipe-client.mjs (the real
// `\\.\pipe\` transport), and `node:http|https|dns|tls|dgram|child_process`
// are forbidden everywhere in electron/, in both variants.
//
// Neither pipe-server.mjs nor pipe-client.mjs exists yet: wiring the actual
// named-pipe transport was explicitly deferred to a BUILD-phase turn (see
// the handoff report for this change) — this turn built the auth/gate/scan
// LOGIC only. So today's correct, and strictly stronger, invariant is zero
// occurrences of ANY of these modules anywhere under electron/: this test
// is the standing proof that this change added no networking code at all.
//
// NOTE for whoever adds pipe-server.mjs/pipe-client.mjs later: relax the
// `net` case below to an allow-list of exactly those two files at that
// point (and add the runtime `\\.\pipe\`-prefix assertion + connect()/Socket
// static checks from C-BR-1 in the same change) — this comment is the
// pointer so that relaxation is a deliberate, reviewed edit, never a
// silent loosening of this test.
const ELECTRON_ROOT = fileURLToPath(new URL('../', import.meta.url));
const FORBIDDEN_MODULES = ['net', 'http', 'https', 'dns', 'tls', 'dgram', 'child_process'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, out);
    else if (/\.(mjs|cjs|js)$/.test(entry) && !entry.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function importsForbiddenModule(source, moduleName) {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`from\\s+['"](?:node:)?${escaped}['"]`),
    new RegExp(`require\\(\\s*['"](?:node:)?${escaped}['"]\\s*\\)`),
    new RegExp(`import\\(\\s*['"](?:node:)?${escaped}['"]\\s*\\)`),
  ];
  return patterns.some((re) => re.test(source));
}

describe('C-BR-2/C-BR-3 network-module invariant (electron/** static grep, production files only)', () => {
  const files = walk(ELECTRON_ROOT);

  it('the walk actually found electron/** implementation files (sanity — an empty list would make every "zero occurrences" test vacuously true)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN_MODULES)('zero occurrences of the %s module anywhere under electron/ today', (moduleName) => {
    const offenders = files.filter((f) => importsForbiddenModule(readFileSync(f, 'utf8'), moduleName));
    expect(offenders).toEqual([]);
  });
});
