import { pipeline } from '@huggingface/transformers';
import { aggregateEntities } from './anonymizer.js';

let ner = null;

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      ner = await pipeline(
        'token-classification',
        'bardsai/eu-pii-anonimization-multilang',
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
      const raw = await ner(e.data.text);
      const data = raw[0]?.entity_group
        ? raw
        : aggregateEntities(raw, e.data.text);
      self.postMessage({ type: 'result', data });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
