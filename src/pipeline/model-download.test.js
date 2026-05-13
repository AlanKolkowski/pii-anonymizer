import { filesForModelSource, hfResolveUrl, modelFileForDtype } from './model-download.js';

const DEF = {
  id: 'wjarka/eu-pii-anonimization-pl',
  dtype: 'fp16',
  sizeBytes: 555323817,
};

describe('model-download helpers', () => {
  it('maps transformers.js dtypes to ONNX filenames', () => {
    expect(modelFileForDtype('fp32')).toBe('onnx/model.onnx');
    expect(modelFileForDtype('fp16')).toBe('onnx/model_fp16.onnx');
    expect(modelFileForDtype('q8')).toBe('onnx/model_quantized.onnx');
  });

  it('lists the config, tokenizer, and selected ONNX artifact for a source', () => {
    expect(filesForModelSource(DEF)).toEqual([
      { file: 'config.json' },
      { file: 'tokenizer_config.json' },
      { file: 'tokenizer.json' },
      { file: 'onnx/model_fp16.onnx', sizeBytes: 555323817 },
    ]);
  });

  it('builds the same resolve URL shape used by transformers.js cache keys', () => {
    expect(hfResolveUrl(DEF.id, 'onnx/model_fp16.onnx')).toBe(
      'https://huggingface.co/wjarka/eu-pii-anonimization-pl/resolve/main/onnx/model_fp16.onnx',
    );
  });
});
