import { pipeline } from '@huggingface/transformers';
import { aggregateEntities, chunkText, deduplicateEntities, filterOversizedEntities, findRegexEntities, mergeAdjacentEntities, snapToWordBoundaries } from './anonymizer.js';

const MAX_CHUNK_CHARS = 1200;

const MODELS = [
  { id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' },
  { id: 'bardsai/eu-pii-anonimization', dtype: 'q8' },
];

let availableModels = [];

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      availableModels = [];
      console.log('[worker] Preloading models (multilang fp32 + PL q8)...');

      const makeOpts = (dtype) => ({
        dtype,
        progress_callback: (data) => {
          if (data.status === 'progress') {
            self.postMessage({
              type: 'progress',
              file: data.file,
              progress: data.progress,
            });
          }
        },
      });

      // Preload models one at a time — load, verify, dispose.
      // Keeps only one model in WASM memory at a time.
      for (const model of MODELS) {
        try {
          const ner = await pipeline('token-classification', model.id, makeOpts(model.dtype));
          await ner.dispose();
          availableModels.push(model);
          console.log(`[worker] ${model.id} (${model.dtype}) preloaded and cached`);
        } catch (err) {
          console.warn(`[worker] ${model.id} (${model.dtype}) failed to preload:`, err);
        }
      }

      if (availableModels.length === 0) {
        self.postMessage({ type: 'error', message: 'No models could be loaded' });
        return;
      }

      console.log(`[worker] ${availableModels.length} model(s) ready`);
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      console.error('[worker] Preload failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'classify') {
    if (availableModels.length === 0) {
      self.postMessage({ type: 'error', message: 'Models not loaded' });
      return;
    }
    try {
      const text = e.data.text;
      const chunks = chunkText(text, MAX_CHUNK_CHARS);

      console.log(`[worker] Text length: ${text.length}, Chunks: ${chunks.length}, Models: ${availableModels.length}`);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const preview = c.text.slice(0, 60).replace(/\n/g, '\\n');
        const ending = c.text.slice(-40).replace(/\n/g, '\\n');
        console.log(`[worker] Chunk ${i}: offset=${c.offset} len=${c.text.length} "${preview}..." ..."${ending}"`);
      }

      const allEntities = [];

      // Run each model sequentially: load from cache → infer all chunks → dispose.
      // Only one model in WASM memory at a time — allows fp32 to work.
      for (const model of availableModels) {
        const ner = await pipeline('token-classification', model.id, { dtype: model.dtype });

        for (const chunk of chunks) {
          const raw = await ner(chunk.text);
          const chunkEntities = raw[0]?.entity_group
            ? raw
            : aggregateEntities(raw, chunk.text);

          for (const entity of chunkEntities) {
            allEntities.push({
              ...entity,
              start: entity.start + chunk.offset,
              end: entity.end + chunk.offset,
            });
          }
        }

        await ner.dispose();
      }

      // Snap NER entities to word boundaries (fixes partial-word detections
      // like "not" from "notariusz" or "N" from "Nadawca")
      const snapped = snapToWordBoundaries(allEntities, text);

      // Drop hallucinated oversized entities (e.g. entire sentences as PERSON_NAME)
      // before dedup so correct shorter detections from the other model survive
      const filtered = filterOversizedEntities(snapped);

      // Add regex-detected entities
      filtered.push(...findRegexEntities(text));

      const deduped = deduplicateEntities(filtered);
      const data = mergeAdjacentEntities(deduped, text);
      self.postMessage({ type: 'result', data });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
