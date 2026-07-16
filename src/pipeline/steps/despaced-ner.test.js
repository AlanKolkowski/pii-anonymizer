import { createDespacedNerStep, DESPACED_SOURCE } from './despaced-ner.js';

const SOURCES_STUB = [
  { alias: 'multilang-fp32', id: 'stub/multilang', dtype: 'fp32' },
  { alias: 'polish-fp16', id: 'stub/pl', dtype: 'fp16' },
];

// Mirrors case-folded-goldens.test.js's textOnlyMock: each matcher fires on
// the FIRST occurrence of its needle in the inferred text. Needles below are
// glued forms only, so a hit is proof the model saw the variant.
function makeMock(matchers) {
  const calls = [];
  const loadModel = async () => ({
    infer: async (text) => {
      calls.push(text);
      const out = [];
      for (const { needle, group, score } of matchers) {
        const idx = text.indexOf(needle);
        if (idx >= 0) out.push({ entity_group: group, start: idx, end: idx + needle.length, score: score ?? 0.9 });
      }
      return out;
    },
    dispose: async () => {},
  });
  return { loadModel, calls };
}

function ctxFor(text, { meta } = {}) {
  return {
    text,
    segments: [{ text, offset: 0 }],
    entities: [],
    anonymized: '',
    legend: {},
    debug: [],
    ...(meta && { meta }),
  };
}

const SPACED_TEXT = 'Pozwana W r ó b l e w s k a nie stawiła się.';

describe('createDespacedNerStep — provenance gate (§2.2 pkt 6)', () => {
  it('is a hard no-op without ctx.meta.ocrProvenance: no inference, ctx unchanged', async () => {
    const { loadModel, calls } = makeMock([{ needle: 'Wróblewska', group: 'PERSON_NAME' }]);
    const step = createDespacedNerStep(SOURCES_STUB, loadModel);
    const ctx = ctxFor(SPACED_TEXT);
    expect(await step(ctx)).toBe(ctx);
    const ctxFalse = ctxFor(SPACED_TEXT, { meta: { ocrProvenance: false } });
    expect(await step(ctxFalse)).toBe(ctxFalse);
    expect(calls).toEqual([]);
  });

  it('does not infer when the flag is set but nothing is spaced', async () => {
    const { loadModel, calls } = makeMock([{ needle: 'Kowalski', group: 'PERSON_NAME' }]);
    const step = createDespacedNerStep(SOURCES_STUB, loadModel);
    const ctx = ctxFor('Jan Kowalski mieszka w Toruniu.', { meta: { ocrProvenance: true } });
    expect(await step(ctx)).toBe(ctx);
    expect(calls).toEqual([]);
  });

  it('respects active: false (cache-orchestrator per-source loop contract)', async () => {
    const { loadModel, calls } = makeMock([{ needle: 'Wróblewska', group: 'PERSON_NAME' }]);
    const step = createDespacedNerStep(SOURCES_STUB, loadModel, { active: false });
    const ctx = ctxFor(SPACED_TEXT, { meta: { ocrProvenance: true } });
    expect(await step(ctx)).toBe(ctx);
    expect(calls).toEqual([]);
  });
});

describe('createDespacedNerStep — remap and filters', () => {
  it('maps a variant candidate back to the full spaced span with source despaced', async () => {
    const { loadModel, calls } = makeMock([{ needle: 'Wróblewska', group: 'PERSON_NAME' }]);
    const step = createDespacedNerStep(SOURCES_STUB, loadModel);
    const out = await step(ctxFor(SPACED_TEXT, { meta: { ocrProvenance: true } }));

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((t) => t.includes('Wróblewska'))).toBe(true);

    // Two sources × one qualifying segment; both find the same span, dedup
    // is downstream postprocess business — here we assert the raw mapping.
    expect(out.entities.length).toBeGreaterThan(0);
    for (const entity of out.entities) {
      expect(entity.source).toBe(DESPACED_SOURCE);
      expect(entity.entity_group).toBe('PERSON_NAME');
      expect(SPACED_TEXT.slice(entity.start, entity.end)).toBe('W r ó b l e w s k a');
    }
  });

  it('keeps global offsets right for a later segment', async () => {
    const { loadModel } = makeMock([{ needle: 'Kamiński', group: 'PERSON_NAME' }]);
    const step = createDespacedNerStep(SOURCES_STUB.slice(0, 1), loadModel);
    const first = 'Zwykłe zdanie otwierające.';
    const second = 'Świadek K a m i ń s k i zeznał.';
    const text = `${first} ${second}`;
    const ctx = {
      ...ctxFor(text, { meta: { ocrProvenance: true } }),
      segments: [
        { text: first, offset: 0 },
        { text: second, offset: first.length + 1 },
      ],
    };
    const out = await step(ctx);
    expect(out.entities).toHaveLength(1);
    expect(text.slice(out.entities[0].start, out.entities[0].end)).toBe('K a m i ń s k i');
  });

  it('drops types outside the closed five-type list', async () => {
    const { loadModel } = makeMock([{ needle: 'Wróblewska', group: 'PERSON_IDENTIFIER' }]);
    const step = createDespacedNerStep(SOURCES_STUB.slice(0, 1), loadModel);
    const out = await step(ctxFor(SPACED_TEXT, { meta: { ocrProvenance: true } }));
    expect(out.entities).toEqual([]);
  });

  it('drops structural-marker spans (glued+folded header shapes)', async () => {
    const { loadModel } = makeMock([{ needle: 'Umowa Kredytu', group: 'ORGANIZATION_NAME' }]);
    const step = createDespacedNerStep(SOURCES_STUB.slice(0, 1), loadModel);
    const text = 'U M O W A  K R E D Y T U zawarta dnia 1 maja.';
    const out = await step(ctxFor(text, { meta: { ocrProvenance: true } }));
    expect(out.entities).toEqual([]);
  });

  it('drops candidates that do not cover any detected spaced word', async () => {
    // "Toruniu" exists identically in the variant's identity-copied tail —
    // the main pass already saw it; re-emitting would only re-litigate it.
    const { loadModel } = makeMock([{ needle: 'Toruniu', group: 'LOCATION' }]);
    const step = createDespacedNerStep(SOURCES_STUB.slice(0, 1), loadModel);
    const text = 'Pozwana W r ó b l e w s k a mieszka w Toruniu.';
    const out = await step(ctxFor(text, { meta: { ocrProvenance: true } }));
    expect(out.entities).toEqual([]);
  });

  it('keeps a candidate that extends beyond the word into surrounding context', async () => {
    const { loadModel } = makeMock([{ needle: 'radca Wróblewska', group: 'PERSON_ROLE_OR_TITLE' }]);
    const step = createDespacedNerStep(SOURCES_STUB.slice(0, 1), loadModel);
    const text = 'Stawiła się radca W r ó b l e w s k a osobiście.';
    const out = await step(ctxFor(text, { meta: { ocrProvenance: true } }));
    expect(out.entities).toHaveLength(1);
    expect(text.slice(out.entities[0].start, out.entities[0].end)).toBe('radca W r ó b l e w s k a');
  });
});
