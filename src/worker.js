import { pipeline } from '@huggingface/transformers';
import { aggregateEntities, chunkText, deduplicateEntities, findRegexEntities } from './anonymizer.js';

let ner = null;

const MAX_CHUNK_CHARS = 1200;

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      ner = await pipeline(
        'token-classification',
        'bardsai/eu-pii-anonimization',
        {
          dtype: 'q8',
          progress_callback: (data) => {
            if (data.status === 'progress') {
              self.postMessage({
                type: 'progress',
                file: data.file,
                progress: data.progress,
              });
            }
          },
        },
      );
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'classify') {
    if (!ner) {
      self.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }
    try {
      const text = e.data.text;
      const chunks = chunkText(text, MAX_CHUNK_CHARS);

      const allEntities = [];
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

      // Merge regex-detected emails (catches full addresses the model may fragment)
      allEntities.push(...findRegexEntities(text));

      const data = deduplicateEntities(allEntities);
      self.postMessage({ type: 'result', data });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
