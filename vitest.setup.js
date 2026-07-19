// Global Vitest setup (feature/fl5-default-on).
//
// src/main.js kicks off a fire-and-forget load right after boot
// (FL-5-LIVE-WIRING-DESIGN.md K5/§5.2):
//
//   loadMorphArtifact().then((loaded) => {
//     morph = loaded;
//     morphReady = true;
//     deanonWorkspace.render();
//   });
//
// — deliberately non-blocking, so the real app's UI wires up immediately
// without waiting on the (tiny, bundled) morphology artifact's async dynamic
// import. With FLEXION_LIVE_DEFAULT now `true`, that late `.then(render)` is
// no longer an inert no-op: it re-renders the live deanon workspace.
//
// `main.*.test.js` files each build a fresh app instance per test via their
// own `bootApp()` helper (`vi.resetModules()` + `await import('./main.js')`),
// but nothing in the suite ever awaits or flushes THIS specific promise.
// Under Vitest's default `forks` pool, one process/JS realm is reused across
// many test files for performance — a still-pending real Promise from file
// A's module instance keeps ticking on that SAME realm's microtask queue
// while file B's test is running. When the artifact's dynamic import
// resolves later than the test that triggered it, the stale callback fires
// mid-test in a DIFFERENT file, touching whatever DOM/state happens to be
// live at that moment. Every file is green in isolation; the full suite is
// flaky, with a different subset failing each run — the signature of
// cross-file pollution, not a real defect in any one test.
//
// Fix: after EVERY test, explicitly await the artifact module's memoized
// promise. `loadMorphArtifact()` returns the SAME promise instance main.js
// already chained `.then(render)` onto (module singleton) — promise
// reactions fire in registration order, so by the time our `await` resumes,
// main.js's `render` has ALREADY run, against the DOM of the test that is
// just now finishing (never a later one). `__resetMorphArtifactForTests()`
// then clears the module's memo so a test file that does not itself call
// `vi.resetModules()` still starts its next `loadMorphArtifact()` call (if
// any) from a clean slate.
//
// Applied globally (every test file, every environment) rather than only to
// the four `main.*.test.js` files: `loadMorphArtifact()` is environment-
// agnostic (no DOM dependency), its cost is one cached dynamic import per
// `vi.resetModules()` boundary (negligible against the full suite's
// runtime), and this protects any FUTURE test file that boots main.js from
// having to remember this by hand.
//
// Deliberately does NOT call `vi.resetModules()` here: that would reset the
// entire module registry after every test in the whole suite, including
// files that intentionally rely on a module singleton persisting across
// their own `it()` blocks (e.g. src/verifier/morph/artifact.test.js resets
// only via this same exported hatch, in its own `beforeEach`). Scoping the
// fix to exactly the one singleton responsible for the leak keeps this a
// test-isolation fix, not a change to any other file's test semantics.
import { afterEach } from 'vitest';

afterEach(async () => {
  const { loadMorphArtifact, __resetMorphArtifactForTests } = await import('./src/verifier/morph/artifact.js');
  await loadMorphArtifact();
  __resetMorphArtifactForTests();
});
