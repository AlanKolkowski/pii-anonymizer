import { pipeline } from '@huggingface/transformers';

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
      const results = await ner(e.data.text, {
        aggregation_strategy: 'simple',
      });
      self.postMessage({ type: 'result', data: results });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
