// FL-5-LIVE-WIRING-DESIGN.md K5/§5.2: the ONE module that ever imports the
// compiled morph-pl artifact. A bundler dynamic `import()` of a JSON file
// (code-split chunk, Vite's built-in JSON handling — no fetch/URL, no
// network path in either the web or desktop build; the desktop asar+fuse
// integrity check covers this file automatically like every other bundled
// asset, air-gap unaffected, G-FL5-6). Loaded once and memoized: every
// caller past the first shares the SAME loaded (or null, on failure) result,
// so a re-render never re-imports or re-parses the artifact.
//
// K5 scope note (§5.1 drabinka szczebli): the bundled artifact today is
// EMPTY-BUT-VALID `morph-pl/1` (data/morph-pl-core.json: imiona/nazwiska/
// role all `{}`) — the A0 tier, semantically identical to `morph: null`
// (every dictionary lookup misses, exactly like today's restricted mode).
// This proves the artifact/loader/code-split plumbing end to end ahead of a
// real data drop; A1 (role-v0, K6) or A2 (imiona-core) replace ONLY the JSON
// file's content in a later, separately-gated step — zero lines change here
// or in any downstream caller.
import { loadMorphData } from './load.js';

let artifactPromise = null;

/**
 * Loads (once) and returns the compiled morph-pl artifact, or `null` if the
 * dynamic import/parse fails — main.js treats `null` exactly like it always
 * has (the restricted, fail-closed mode §4.4 of the parent design describes,
 * never an error the user sees). Safe to call from multiple places; every
 * call after the first awaits the SAME in-flight/settled promise.
 *
 * @returns {Promise<object|null>}
 */
export function loadMorphArtifact() {
  artifactPromise ??= import('./data/morph-pl-core.json')
    .then((mod) => loadMorphData(mod.default ?? mod))
    .catch((err) => {
      console.warn('[verifier/morph/artifact] failed to load morphology artifact, falling back to null (restricted mode):', err);
      return null;
    });
  return artifactPromise;
}

// Test-only escape hatch: the module-level memoization is deliberate in the
// app (load once per session) but must not leak between independent test
// cases in the same file/process.
export function __resetMorphArtifactForTests() {
  artifactPromise = null;
}
