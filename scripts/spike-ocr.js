// Spike: load PP-OCRv4 in browser-style env and run it on a fixture image.
// Run in a browser tab (`npm run dev` then visit /spike-ocr.html`) — onnxruntime-web
// is browser-only.
import * as ort from 'onnxruntime-web';

const candidate = await import('@gutenye/ocr-browser').catch(() => null);

async function main() {
  console.log(
    '[spike] available providers:',
    ort.env?.wasm?.numThreads,
    Object.keys(ort.env ?? {}),
  );

  if (candidate?.default || candidate?.create) {
    const create = candidate.default ?? candidate.create;
    const ocr = await create({
      // NOTE: bundled defaults are Chinese PP-OCRv4. For Polish, point these at
      // the multilingual recognition model + Latin char dictionary (see
      // src/ocr/SPIKE.md and src/ocr/models.js for the planned URLs).
      models: {
        detectionPath: '/ocr/models/PP-OCRv4_det_infer.onnx',
        recognitionPath: '/ocr/models/PP-OCRv4_rec_multilingual_infer.onnx',
        dictionaryPath: '/ocr/models/latin_dict.txt',
      },
      onnxOptions: {
        executionProviders: ['webnn', 'wasm'],
      },
    });
    const img = document.querySelector('#spike-img');
    const result = await ocr.detect(img);
    console.log('[spike] @gutenye/ocr-browser result:', result);
    return;
  }

  console.log('[spike] no wrapper — would need to wire ort directly here');
}
main().catch((err) => console.error('[spike] failed:', err));
