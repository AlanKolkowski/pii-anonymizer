import { pipeline } from '@huggingface/transformers';
import { aggregateEntities, chunkText, deduplicateEntities, findRegexEntities, mergeAdjacentEntities, snapToWordBoundaries } from './anonymizer.js';

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

      console.log(`[worker] Text length: ${text.length}, Chunks: ${chunks.length}`);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const preview = c.text.slice(0, 60).replace(/\n/g, '\\n');
        const ending = c.text.slice(-40).replace(/\n/g, '\\n');
        console.log(`[worker] Chunk ${i}: offset=${c.offset} len=${c.text.length} "${preview}..." ..."${ending}"`);
      }

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

      // Snap NER entities to word boundaries (fixes partial-word detections
      // like "not" from "notariusz" or "N" from "Nadawca")
      const snapped = snapToWordBoundaries(allEntities, text);

      // Add regex-detected entities
      snapped.push(...findRegexEntities(text));

      const deduped = deduplicateEntities(snapped);
      const data = mergeAdjacentEntities(deduped, text);
      self.postMessage({ type: 'result', data });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
