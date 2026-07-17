import { get_sentence_boundaries } from 'sentencex';
import { createDefaultPipeline } from './configs/default.js';
import { createContext } from './context.js';
import { runPipeline } from './runner.js';
import { allEntityTypes } from './configs/entity-sources.js';

// OS-1 (OCR-SPACING-DESIGN.md §2.3/§2.4) acceptance goldens, end-to-end
// through createDefaultPipeline with mocked models — same pattern as
// case-folded-goldens.test.js: each mock recognizes ONLY the glued form of
// its target, never the spaced original, so a masked result is proof the
// candidate came from the despaced variant pass. Measured recall/precision
// on the real corpora comes from tagged `npm run eval` runs, not from here.

const ALL_ENTITIES = allEntityTypes();

function textOnlyMock(matchers) {
  return async () => ({
    infer: async (text) => {
      const out = [];
      for (const { needle, group, score } of matchers) {
        const idx = text.indexOf(needle);
        if (idx >= 0) out.push({ entity_group: group, start: idx, end: idx + needle.length, score: score ?? 0.9 });
      }
      return out;
    },
    dispose: async () => {},
  });
}

function ocrCtx(text) {
  return { ...createContext(text), meta: { ocrProvenance: true } };
}

describe('OS-1 goldens — spaced surname masked on an OCR document', () => {
  const text = 'Pozwana W r ó b l e w s k a nie stawiła się na rozprawie.';
  const mock = textOnlyMock([{ needle: 'Wróblewska', group: 'PERSON_NAME', score: 0.92 }]);

  it('masks the full spaced span when provenance is set', async () => {
    const pipeline = createDefaultPipeline(mock, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const result = await runPipeline(ocrCtx(text), pipeline);
    expect(result.anonymized).toBe('Pozwana [PERSON_NAME_1] nie stawiła się na rozprawie.');
    expect(result.legend['[PERSON_NAME_1]']).toBe('W r ó b l e w s k a');
  });

  it('isolation: the same document without the flag is untouched', async () => {
    const pipeline = createDefaultPipeline(mock, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const result = await runPipeline(text, pipeline);
    expect(result.anonymized).toBe(text);
    expect(result.entities).toEqual([]);
  });
});

describe('OS-1 goldens — spaced two-word phrase (imię i nazwisko)', () => {
  it('masks the whole phrase from one variant candidate', async () => {
    const text = 'Stawiła się B o ż e n a  W r ó b l e w s k a osobiście.';
    const mock = textOnlyMock([{ needle: 'Bożena Wróblewska', group: 'PERSON_NAME', score: 0.95 }]);
    const pipeline = createDefaultPipeline(mock, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const result = await runPipeline(ocrCtx(text), pipeline);
    expect(result.anonymized).toBe('Stawiła się [PERSON_NAME_1] osobiście.');
    expect(result.legend['[PERSON_NAME_1]']).toBe('B o ż e n a  W r ó b l e w s k a');
  });
});

describe('OS-1 goldens — spaced institution header typed ORG, never PERSON_NAME (§2.3 pkt 3)', () => {
  it('a spaced all-caps office header comes out as ORGANIZATION_NAME', async () => {
    const text = 'W I E L K O P O L S K I  U R Z Ą D  W O J E W Ó D Z K I\n\nwzywa do stawiennictwa.';
    const mock = textOnlyMock([
      { needle: 'Wielkopolski Urząd Wojewódzki', group: 'ORGANIZATION_NAME', score: 0.93 },
    ]);
    const pipeline = createDefaultPipeline(mock, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const result = await runPipeline(ocrCtx(text), pipeline);
    expect(result.anonymized).not.toMatch(/\[PERSON_NAME_\d+\]/);
    expect(result.anonymized).toMatch(/\[ORGANIZATION_NAME_\d+\]/);
  });

  it('a spaced document-title header is silenced by the structural-marker guard', async () => {
    const text = 'U M O W A  K R E D Y T U\n\nzawarta pomiędzy stronami.';
    const mock = textOnlyMock([
      { needle: 'Umowa Kredytu', group: 'ORGANIZATION_NAME', score: 0.95 },
    ]);
    const pipeline = createDefaultPipeline(mock, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const result = await runPipeline(ocrCtx(text), pipeline);
    expect(result.anonymized).toBe(text);
  });
});

describe('OS-1 goldens — scope boundary stays a named FN (§2.3 pkt 4)', () => {
  it('glue-ups and hyphenation carries are NOT handled by this module', async () => {
    const text = 'Pozwana BożenaWróblewska oraz Wr-\nóblewską wymienione w aktach.';
    // The mock knows only the clean two-word form — neither the glue-up nor
    // the hyphen carry contains it, and the despace grammar produces no
    // variant here (no spaced letters), so the module must stay silent.
    const mock = textOnlyMock([{ needle: 'Bożena Wróblewska', group: 'PERSON_NAME', score: 0.95 }]);
    const pipeline = createDefaultPipeline(mock, get_sentence_boundaries, { enabledEntities: ALL_ENTITIES });
    const result = await runPipeline(ocrCtx(text), pipeline);
    // Deliberate: these two distortion classes remain out of scope, measured
    // separately (they must not silently ride on "OCR recall").
    expect(result.anonymized).toContain('BożenaWróblewska');
    expect(result.anonymized).toContain('Wr-\nóblewską');
  });
});
