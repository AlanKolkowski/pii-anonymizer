import { pipeline } from '@huggingface/transformers';
import { aggregateEntities, chunkText, deduplicateEntities, findRegexEntities, mergeAdjacentEntities } from './anonymizer.js';

let nerMultilang = null;
let nerPl = null;

const MAX_CHUNK_CHARS = 1200;

const MODELS = [
  'bardsai/eu-pii-anonimization-multilang',
  'bardsai/eu-pii-anonimization',
];

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      const dtype = e.data.dtype || 'q8';
      console.log('[worker] Loading dual models with dtype:', dtype);

      const makeOpts = () => ({
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

      nerMultilang = await pipeline('token-classification', MODELS[0], makeOpts());
      console.log('[worker] Multilang model loaded');

      nerPl = await pipeline('token-classification', MODELS[1], makeOpts());
      console.log('[worker] PL model loaded');

      self.postMessage({ type: 'loaded' });
    } catch (err) {
      console.error('[worker] Pipeline load failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'classify') {
    if (!nerMultilang || !nerPl) {
      self.postMessage({ type: 'error', message: 'Models not loaded' });
      return;
    }
    try {
      const text = e.data.text;
      const chunks = chunkText(text, MAX_CHUNK_CHARS);

      const allEntities = [];

      for (const chunk of chunks) {
        // Run both models on each chunk
        const [rawMulti, rawPl] = await Promise.all([
          nerMultilang(chunk.text),
          nerPl(chunk.text),
        ]);

        for (const raw of [rawMulti, rawPl]) {
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
      }

      // Add regex-detected entities
      allEntities.push(...findRegexEntities(text));

      const deduped = deduplicateEntities(allEntities);
      const data = mergeAdjacentEntities(deduped, text);
      self.postMessage({ type: 'result', data });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
