const DTYPE_SUFFIX = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
};

function pathJoin(...parts) {
  return parts
    .map((part, index) => {
      let p = String(part);
      if (index) p = p.replace(/^\//, '');
      if (index !== parts.length - 1) p = p.replace(/\/$/, '');
      return p;
    })
    .join('/');
}

export function modelFileForDtype(dtype) {
  if (!Object.prototype.hasOwnProperty.call(DTYPE_SUFFIX, dtype)) {
    throw new Error(`Unsupported model dtype: ${dtype}`);
  }
  return `onnx/model${DTYPE_SUFFIX[dtype]}.onnx`;
}

export function filesForModelSource(def) {
  return [
    { file: 'config.json' },
    { file: 'tokenizer_config.json' },
    { file: 'tokenizer.json' },
    { file: modelFileForDtype(def.dtype), sizeBytes: def.sizeBytes },
  ];
}

export function hfResolveUrl(modelId, filename, {
  revision = 'main',
  remoteHost = 'https://huggingface.co/',
  remotePathTemplate = '{model}/resolve/{revision}/',
} = {}) {
  return pathJoin(
    remoteHost,
    remotePathTemplate
      .replaceAll('{model}', modelId)
      .replaceAll('{revision}', encodeURIComponent(revision)),
    filename,
  );
}

async function cacheMatchAny(cache, ...keys) {
  for (const key of keys) {
    try {
      const hit = await cache.match(key);
      if (hit) return hit;
    } catch {}
  }
  return undefined;
}

async function putStreamingWithProgress(cache, cacheKey, response, {
  file,
  expectedBytes = 0,
  progressCallback = () => {},
} = {}) {
  const headerBytes = Number(response.headers.get('Content-Length') ?? 0);
  const total = Number.isFinite(headerBytes) && headerBytes > 0 ? headerBytes : (expectedBytes ?? 0);
  let loaded = 0;

  const body = response.body?.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength ?? chunk.length ?? 0;
      progressCallback({
        status: 'progress',
        file,
        progress: total > 0 ? (loaded / total) * 100 : 0,
        loaded,
        total,
      });
      controller.enqueue(chunk);
    },
  }));

  if (!body) {
    const buffer = await response.arrayBuffer();
    loaded = buffer.byteLength;
    progressCallback({ status: 'progress', file, progress: 100, loaded, total: total || loaded });
    await cache.put(cacheKey, new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }));
    return;
  }

  await cache.put(cacheKey, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }));

  progressCallback({ status: 'progress', file, progress: 100, loaded, total: total || loaded });
}

export async function ensureModelFileCached(modelId, file, {
  sizeBytes = 0,
  revision = 'main',
  cacheStorage = globalThis.caches,
  fetchFn = globalThis.fetch?.bind(globalThis),
  progressCallback = () => {},
} = {}) {
  if (!cacheStorage || !fetchFn) return { skipped: true };

  const cache = await cacheStorage.open('transformers-cache');
  const remoteUrl = hfResolveUrl(modelId, file, { revision });
  const localPath = pathJoin('./models/', modelId, file);

  if (await cacheMatchAny(cache, localPath, remoteUrl)) {
    progressCallback({ status: 'progress', file, progress: 100, loaded: sizeBytes, total: sizeBytes });
    return { cached: true };
  }

  progressCallback({ status: 'download', file, progress: 0, loaded: 0, total: sizeBytes });
  const response = await fetchFn(remoteUrl);
  if (!response.ok) {
    throw new Error(`Could not download model file ${remoteUrl}: ${response.status} ${response.statusText}`);
  }

  try {
    await putStreamingWithProgress(cache, remoteUrl, response, {
      file,
      expectedBytes: sizeBytes,
      progressCallback,
    });
  } catch (err) {
    console.warn(`[model-download] unable to cache ${file}:`, err);
    return { cached: false, error: err };
  }

  return { cached: true };
}

export async function ensureModelSourceCached(def, options = {}) {
  for (const { file, sizeBytes } of filesForModelSource(def)) {
    await ensureModelFileCached(def.id, file, { ...options, sizeBytes });
  }
}
