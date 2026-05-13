import {
  ensureModelSourcesCached,
  filesForModelSource,
  hfResolveUrl,
  modelFileForDtype,
  planModelDownloads,
} from './model-download.js';

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

  it('plans only uncached unique files and totals their remaining bytes', async () => {
    const a = { id: 'test/shared-model', dtype: 'fp16', sizeBytes: 100 };
    const b = { id: 'test/shared-model', dtype: 'fp32', sizeBytes: 200 };
    const cacheStorage = makeCacheStorage([
      hfResolveUrl(a.id, 'config.json'),
    ]);
    const fetchFn = makeFetch({
      [hfResolveUrl(a.id, 'tokenizer_config.json')]: 20,
      [hfResolveUrl(a.id, 'tokenizer.json')]: 80,
    });

    const plan = await planModelDownloads([a, b], { cacheStorage: cacheStorage.cacheStorage, fetchFn });

    expect(plan).toMatchObject({
      skipped: false,
      cachedFiles: 1,
      totalFiles: 5,
      totalBytes: 400,
    });
    expect(plan.files.map((f) => f.file)).toEqual([
      'tokenizer_config.json',
      'tokenizer.json',
      'onnx/model_fp16.onnx',
      'onnx/model.onnx',
    ]);
    expect(fetchFn).toHaveBeenCalledWith(hfResolveUrl(a.id, 'tokenizer_config.json'), { method: 'HEAD' });
    expect(fetchFn).toHaveBeenCalledWith(hfResolveUrl(a.id, 'tokenizer.json'), { method: 'HEAD' });
  });

  it('emits aggregate download progress across all missing files', async () => {
    const def = { id: 'test/progress-model', dtype: 'fp16', sizeBytes: 100 };
    const lengths = {
      [hfResolveUrl(def.id, 'config.json')]: 10,
      [hfResolveUrl(def.id, 'tokenizer_config.json')]: 20,
      [hfResolveUrl(def.id, 'tokenizer.json')]: 30,
      [hfResolveUrl(def.id, 'onnx/model_fp16.onnx')]: 100,
    };
    const events = [];

    await ensureModelSourcesCached([def], {
      cacheStorage: makeCacheStorage().cacheStorage,
      fetchFn: makeFetch(lengths),
      progressCallback: (event) => events.push(event),
    });

    expect(events[0]).toMatchObject({
      status: 'plan',
      progress: 0,
      loadedBytes: 0,
      totalBytes: 160,
      remainingFiles: 4,
      totalFiles: 4,
    });
    expect(events.at(-1)).toMatchObject({
      status: 'progress',
      progress: 100,
      loadedBytes: 160,
      totalBytes: 160,
    });
    const aggregateEvents = events.filter((event) => event.loadedBytes != null && event.totalBytes > 0);
    expect(aggregateEvents.every((event) => event.totalBytes === 160)).toBe(true);
  });
});

function makeCacheStorage(initialKeys = []) {
  const keys = new Set(initialKeys);
  const cache = {
    match: vi.fn(async (key) => (keys.has(String(key)) ? new Response('hit') : undefined)),
    put: vi.fn(async (key, response) => {
      keys.add(String(key));
      await response.arrayBuffer();
    }),
  };
  return {
    cacheStorage: { open: vi.fn(async () => cache) },
    cache,
    keys,
  };
}

function makeFetch(lengths = {}) {
  return vi.fn(async (url, options = {}) => {
    const size = lengths[url] ?? 0;
    if (options.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(size) },
      });
    }
    return new Response(new Uint8Array(size), {
      status: 200,
      headers: { 'Content-Length': String(size) },
    });
  });
}
