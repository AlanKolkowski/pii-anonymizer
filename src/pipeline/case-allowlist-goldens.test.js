import { get_sentence_boundaries } from 'sentencex';
import { createDefaultPipeline } from './configs/default.js';
import { runPipeline } from './runner.js';
import { allEntityTypes } from './configs/entity-sources.js';

// ST-5 (SCOPE-TIERS-DESIGN.md §5.3) acceptance goldens, end-to-end through
// createDefaultPipeline with a silent model mock — every DOCUMENT_REFERENCE
// below can only come from the allowlist step, so a masked signature is
// proof of the deterministic matcher, not of a model.

const ALL_ENTITIES = allEntityTypes();

const silentModel = async () => ({
  infer: async () => [],
  dispose: async () => {},
});

function pipelineWith(allowlist, extra = {}) {
  return createDefaultPipeline(silentModel, get_sentence_boundaries, {
    enabledEntities: ALL_ENTITIES,
    ...(allowlist && { caseAllowlist: allowlist }),
    ...extra,
  });
}

// The distinctive behavior lives in the tiered profile: DOCUMENT_REFERENCE
// is tier 'pass' there, so a detected-but-not-allowlisted signature (cited
// rulings, regex DOCKET hits) stays visible while the allowlisted one is
// masked through forceTier. Under today's allMask default the regex source
// already masks signature-shaped spans, so the allowlist adds nothing
// observable — covered by the invariance golden below.
const TIERED = { allMask: false };

describe('ST-5 goldens — own case signature masked, citations stay visible (tiered)', () => {
  const text = 'W sprawie o sygn. akt I C 1552/23 powód powołał uchwałę SN III CZP 6/21 '
    + 'oraz wskazał, że w aktach I C 1552/2023 znajduje się opinia.';

  it('masks every variant of the allowlisted signature and nothing else', async () => {
    const result = await runPipeline(text, pipelineWith(['I C 1552/23'], TIERED));
    expect(result.anonymized).toBe(
      'W sprawie o sygn. akt [DOCUMENT_REFERENCE_1] powód powołał uchwałę SN III CZP 6/21 '
      + 'oraz wskazał, że w aktach [DOCUMENT_REFERENCE_2] znajduje się opinia.',
    );
    expect(result.legend['[DOCUMENT_REFERENCE_1]']).toBe('I C 1552/23');
    expect(result.legend['[DOCUMENT_REFERENCE_2]']).toBe('I C 1552/2023');
  });

  it('without an allowlist entry the same signature stays visible (pass tier)', async () => {
    const result = await runPipeline(text, pipelineWith([], TIERED));
    expect(result.anonymized).toContain('I C 1552/23');
    expect(result.anonymized).not.toMatch(/\[DOCUMENT_REFERENCE_\d+\]/);
  });

  it('empty allowlist = inactive step, output byte-identical (§5.3 pkt 4)', async () => {
    const withEmpty = await runPipeline(text, pipelineWith([]));
    const without = await runPipeline(text, pipelineWith(null));
    expect(withEmpty.anonymized).toBe(without.anonymized);
    expect(withEmpty.entities).toEqual(without.entities);
    expect(withEmpty.legend).toEqual(without.legend);
  });

  it('masks the occurrence with the upr suffix in full (§5.3 pkt 2)', async () => {
    const uprText = 'Nakaz w sprawie II Ca 210/24 upr doręczono pełnomocnikowi.';
    const result = await runPipeline(uprText, pipelineWith(['II Ca 210/24'], TIERED));
    expect(result.anonymized).toBe('Nakaz w sprawie [DOCUMENT_REFERENCE_1] doręczono pełnomocnikowi.');
    expect(result.legend['[DOCUMENT_REFERENCE_1]']).toBe('II Ca 210/24 upr');
  });
});

describe('ST-5 goldens — hyphenated e-court repertorium "Nc-e" (tiered)', () => {
  // EPU / e-Sąd signatures use the repertorium "Nc-e" (hyphenated) — a
  // very common Polish civil-collection signature shape. Under allMask:false
  // this MUST be maskable via the allowlist like any other own signature;
  // before the fix, parseSignature rejected the hyphen and the signature
  // stayed visible (pass tier) despite being the user's own case.
  const text = 'W sprawie o sygn. akt VI Nc-e 1234567/23 wydano nakaz zapłaty.';

  it('masks the allowlisted Nc-e signature (own case, tiered profile)', async () => {
    const result = await runPipeline(text, pipelineWith(['VI Nc-e 1234567/23'], TIERED));
    expect(result.anonymized).toBe('W sprawie o sygn. akt [DOCUMENT_REFERENCE_1] wydano nakaz zapłaty.');
    expect(result.legend['[DOCUMENT_REFERENCE_1]']).toBe('VI Nc-e 1234567/23');
  });
});

describe('ST-5 goldens — JDG fallback reaches the review bucket (tiered profile)', () => {
  const text = 'Pozwana: Kancelaria Radcy Prawnego Jan Kowalski, ul. Piekary 33, Toruń.';

  function orgAwareModel() {
    return async () => ({
      infer: async (t) => {
        const needle = 'Kancelaria Radcy Prawnego Jan Kowalski';
        const idx = t.indexOf(needle);
        return idx >= 0
          ? [{ entity_group: 'ORGANIZATION_NAME', start: idx, end: idx + needle.length, score: 0.9 }]
          : [];
      },
      dispose: async () => {},
    });
  }

  it('an org name with an unknown surname lands whole in reviewCandidates', async () => {
    const pipeline = createDefaultPipeline(orgAwareModel(), get_sentence_boundaries, {
      enabledEntities: ALL_ENTITIES,
      allMask: false,
    });
    const result = await runPipeline(text, pipeline);
    expect(result.reviewCandidates.some(
      (c) => c.entity_group === 'ORGANIZATION_NAME'
        && text.slice(c.start, c.end) === 'Kancelaria Radcy Prawnego Jan Kowalski',
    )).toBe(true);
    // Nothing masked without a decision — the candidate is an offer, not a mask.
    expect(result.anonymized).toContain('Kancelaria Radcy Prawnego Jan Kowalski');
  });

  it('under allMask (default) the fallback is inert and the org is masked as today', async () => {
    const pipeline = createDefaultPipeline(orgAwareModel(), get_sentence_boundaries, {
      enabledEntities: ALL_ENTITIES,
    });
    const result = await runPipeline(text, pipeline);
    expect(result.anonymized).toContain('[ORGANIZATION_NAME_1]');
    expect(result.entities.every((e) => e.forceTier === undefined)).toBe(true);
  });
});
