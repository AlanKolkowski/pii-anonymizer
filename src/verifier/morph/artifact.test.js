// FL-5-LIVE-WIRING-DESIGN.md K5/§5.2: artifact.js is the ONE module that ever
// imports the compiled morph-pl artifact — a bundler dynamic import (never
// fetch/URL, G-FL5-6 air-gap), loaded once and shared (singleton) so main.js
// doesn't reload it on every render. K5 scope ships an EMPTY-BUT-VALID
// morph-pl/1 artifact (imiona/nazwiska/role: {} — semantically identical to
// morph=null, A0 tier); A1 (role-v0) is a separate, later step (K6, gated on
// Alan's review) that only replaces the JSON file's content.
import { loadMorphArtifact, __resetMorphArtifactForTests } from './artifact.js';

describe('loadMorphArtifact (K5)', () => {
  beforeEach(() => {
    __resetMorphArtifactForTests();
  });

  it('loads the bundled artifact into a valid morph-pl/1 structure (loadMorphData shape)', async () => {
    const morph = await loadMorphArtifact();
    expect(morph).not.toBeNull();
    expect(morph.imiona).toBeInstanceOf(Map);
    expect(morph.nazwiska ?? morph.nazwiskaWyjatki).toBeDefined();
    expect(morph.formaDoLematu).toBeInstanceOf(Map);
    expect(morph.meta.wersjaFormatu).toBe('morph-pl/1');
  });

  it('K5 scope: ships empty-but-valid (A0) — every dictionary lookup misses, exactly like morph=null', async () => {
    const morph = await loadMorphArtifact();
    expect(morph.imiona.size).toBe(0);
    expect(morph.nazwiskaWyjatki.size).toBe(0);
    expect(morph.role.size).toBe(0);
  });

  it('is a singleton: repeated calls share the same resolved artifact (no re-fetch per call)', async () => {
    const [a, b] = await Promise.all([loadMorphArtifact(), loadMorphArtifact()]);
    expect(a).toBe(b);
  });
});
