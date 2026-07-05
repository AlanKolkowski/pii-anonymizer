import {
  ensureModelFileCached,
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

describe('model-download in-flight dedup', () => {
  it('fetches once for concurrent ensureModelFileCached calls on the same URL', async () => {
    const modelId = 'test/dedupe-file';
    const file = 'onnx/model_fp16.onnx';
    const { cacheStorage } = makeCacheStorage();

    let resolveFetch;
    const fetchFn = vi.fn(async (url) => {
      if (url !== hfResolveUrl(modelId, file)) {
        return new Response(new Uint8Array(0), { status: 200 });
      }
      return new Promise((resolve) => {
        resolveFetch = () =>
          resolve(new Response(new Uint8Array(100), { status: 200, headers: { 'Content-Length': '100' } }));
      });
    });

    const p1 = ensureModelFileCached(modelId, file, { sizeBytes: 100, cacheStorage, fetchFn });
    const p2 = ensureModelFileCached(modelId, file, { sizeBytes: 100, cacheStorage, fetchFn });

    // Flush the microtask queue so both calls clear the cache check and reach
    // dedupeDownload before the fetch resolves.
    await new Promise((r) => setTimeout(r));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolveFetch();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r1).toMatchObject({ cached: true });
    expect(r2).toMatchObject({ cached: true });
  });

  it('fetches once for concurrent ensureModelSourcesCached + ensureModelFileCached on the same URL', async () => {
    const modelId = 'test/dedupe-mixed';
    const file = 'onnx/model_fp16.onnx';
    const targetUrl = hfResolveUrl(modelId, file);
    const { cacheStorage } = makeCacheStorage();

    let resolveTargetFetch;
    const fetchFn = vi.fn(async (url, options = {}) => {
      if (options.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': '10' } });
      }
      if (url === targetUrl) {
        return new Promise((resolve) => {
          resolveTargetFetch = () =>
            resolve(new Response(new Uint8Array(100), { status: 200, headers: { 'Content-Length': '100' } }));
        });
      }
      // Non-target files resolve immediately so the plan loop advances to the
      // shared onnx file while the ensureModelFileCached download is still pending.
      return new Response(new Uint8Array(10), { status: 200, headers: { 'Content-Length': '10' } });
    });

    const def = { id: modelId, dtype: 'fp16', sizeBytes: 100 };
    const p1 = ensureModelSourcesCached([def], { cacheStorage, fetchFn });
    const p2 = ensureModelFileCached(modelId, file, { sizeBytes: 100, cacheStorage, fetchFn });

    await new Promise((r) => setTimeout(r));
    resolveTargetFetch();
    await Promise.all([p1, p2]);

    const targetGetCalls = fetchFn.mock.calls.filter(
      ([url, options]) => url === targetUrl && options?.method !== 'HEAD',
    );
    expect(targetGetCalls).toHaveLength(1);
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
