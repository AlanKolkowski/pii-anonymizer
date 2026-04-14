import { pipeline as hfPipeline } from '@huggingface/transformers';
import { runPipeline } from './pipeline/runner.js';
import { createDefaultPipeline, MODELS } from './pipeline/configs/default.js';

let pipelineConfig = null;
let availableModels = [];

async function loadModelBrowser(model) {
  const ner = await hfPipeline('token-classification', model.id, { dtype: model.dtype });
  return {
    infer: async (text) => await ner(text),
    dispose: async () => await ner.dispose(),
  };
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      availableModels = [];
      console.log('[worker] Preloading models...');

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
      for (const model of MODELS) {
        try {
          const ner = await hfPipeline('token-classification', model.id, makeOpts(model.dtype));
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

      // Build pipeline config with only the models that loaded successfully
      pipelineConfig = createDefaultPipeline(loadModelBrowser);

      console.log(`[worker] ${availableModels.length} model(s) ready`);
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      console.error('[worker] Preload failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'classify') {
    if (!pipelineConfig) {
      self.postMessage({ type: 'error', message: 'Models not loaded' });
      return;
    }
    try {
      const ctx = await runPipeline(e.data.text, pipelineConfig);

      self.postMessage({
        type: 'result',
        data: ctx.entities,
        anonymized: ctx.anonymized,
        legend: ctx.legend,
        debug: ctx.debug,
      });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
