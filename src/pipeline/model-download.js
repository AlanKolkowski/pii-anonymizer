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

const TRANSFORMERS_CACHE = 'transformers-cache';

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

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sizeFromHeaders(headers) {
  return positiveNumber(headers?.get?.('Content-Length') ?? headers?.get?.('content-length'));
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

function cacheKeysForModelFile(modelId, file, { revision = 'main' } = {}) {
  return {
    remoteUrl: hfResolveUrl(modelId, file, { revision }),
    localPath: pathJoin('./models/', modelId, file),
  };
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

async function remoteContentLength(remoteUrl, fetchFn) {
  try {
    const response = await fetchFn(remoteUrl, { method: 'HEAD' });
    if (!response?.ok) return 0;
    return sizeFromHeaders(response.headers);
  } catch {
    return 0;
  }
}

function uniqueFilesForSources(defs, { revision = 'main' } = {}) {
  const seen = new Set();
  const out = [];

  for (const def of defs) {
    if (!def) continue;
    for (const entry of filesForModelSource(def)) {
      const key = `${def.id}\0${entry.file}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const { remoteUrl, localPath } = cacheKeysForModelFile(def.id, entry.file, { revision });
      out.push({
        key,
        modelId: def.id,
        file: entry.file,
        displayFile: `${def.id}/${entry.file}`,
        sizeBytes: positiveNumber(entry.sizeBytes),
        remoteUrl,
        localPath,
      });
    }
  }

  return out;
}

async function buildDownloadPlan(defs, {
  revision = 'main',
  cacheStorage = globalThis.caches,
  fetchFn = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (!cacheStorage || !fetchFn) {
    return {
      skipped: true,
      cache: null,
      files: [],
      totalBytes: 0,
      cachedFiles: 0,
      totalFiles: 0,
    };
  }

  const cache = await cacheStorage.open(TRANSFORMERS_CACHE);
  const allFiles = uniqueFilesForSources(defs, { revision });
  const files = [];
  let cachedFiles = 0;

  for (const item of allFiles) {
    if (await cacheMatchAny(cache, item.localPath, item.remoteUrl)) {
      cachedFiles += 1;
      continue;
    }

    if (item.sizeBytes === 0) {
      item.sizeBytes = await remoteContentLength(item.remoteUrl, fetchFn);
    }
    files.push(item);
  }

  return {
    skipped: false,
    cache,
    files,
    totalBytes: files.reduce((sum, item) => sum + item.sizeBytes, 0),
    cachedFiles,
    totalFiles: allFiles.length,
  };
}

export async function planModelDownloads(defs, options = {}) {
  const { cache, ...plan } = await buildDownloadPlan(defs, options);
  return plan;
}

async function putStreamingWithProgress(cache, cacheKey, response, {
  file,
  expectedBytes = 0,
  progressCallback = () => {},
} = {}) {
  const headerBytes = sizeFromHeaders(response.headers);
  const total = headerBytes > 0 ? headerBytes : positiveNumber(expectedBytes);
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

  const cache = await cacheStorage.open(TRANSFORMERS_CACHE);
  const { remoteUrl, localPath } = cacheKeysForModelFile(modelId, file, { revision });
  const expectedBytes = positiveNumber(sizeBytes);

  if (await cacheMatchAny(cache, localPath, remoteUrl)) {
    progressCallback({ status: 'progress', file, progress: 100, loaded: expectedBytes, total: expectedBytes });
    return { cached: true };
  }

  progressCallback({ status: 'download', file, progress: 0, loaded: 0, total: expectedBytes });
  const response = await fetchFn(remoteUrl);
  if (!response.ok) {
    throw new Error(`Could not download model file ${remoteUrl}: ${response.status} ${response.statusText}`);
  }

  try {
    await putStreamingWithProgress(cache, remoteUrl, response, {
      file,
      expectedBytes,
      progressCallback,
    });
  } catch (err) {
    console.warn(`[model-download] unable to cache ${file}:`, err);
    return { cached: false, error: err };
  }

  return { cached: true };
}

async function downloadPlannedFile(cache, item, fetchFn, progressCallback) {
  progressCallback({
    status: 'download',
    file: item.displayFile,
    modelId: item.modelId,
    rawFile: item.file,
    progress: 0,
    loaded: 0,
    total: item.sizeBytes,
  });

  const response = await fetchFn(item.remoteUrl);
  if (!response.ok) {
    throw new Error(`Could not download model file ${item.remoteUrl}: ${response.status} ${response.statusText}`);
  }

  try {
    await putStreamingWithProgress(cache, item.remoteUrl, response, {
      file: item.displayFile,
      expectedBytes: item.sizeBytes,
      progressCallback: (event) => progressCallback({
        ...event,
        file: item.displayFile,
        modelId: item.modelId,
        rawFile: item.file,
      }),
    });
  } catch (err) {
    console.warn(`[model-download] unable to cache ${item.displayFile}:`, err);
    return { cached: false, error: err };
  }

  return { cached: true };
}

export async function ensureModelSourcesCached(defs, {
  progressCallback = () => {},
  ...options
} = {}) {
  const plan = await buildDownloadPlan(defs, options);
  const publicPlan = {
    skipped: plan.skipped,
    totalBytes: plan.totalBytes,
    cachedFiles: plan.cachedFiles,
    remainingFiles: plan.files.length,
    totalFiles: plan.totalFiles,
    files: plan.files.map(({ displayFile, sizeBytes, modelId, file }) => ({
      file: displayFile,
      rawFile: file,
      modelId,
      sizeBytes,
    })),
  };

  progressCallback({
    status: 'plan',
    progress: plan.files.length === 0 ? 100 : 0,
    loadedBytes: 0,
    totalBytes: plan.totalBytes,
    ...publicPlan,
  });

  if (plan.skipped || !plan.cache) return publicPlan;

  if (plan.files.length === 0) {
    progressCallback({
      status: 'progress',
      progress: 100,
      loadedBytes: 0,
      totalBytes: 0,
      ...publicPlan,
    });
    return publicPlan;
  }

  const loadedByFile = new Map();
  let totalBytes = plan.totalBytes;
  const results = [];

  for (const item of plan.files) {
    loadedByFile.set(item.key, 0);
    const result = await downloadPlannedFile(
      plan.cache,
      item,
      options.fetchFn ?? globalThis.fetch?.bind(globalThis),
      (event) => {
        const eventTotal = positiveNumber(event.total);
        if (eventTotal > 0 && eventTotal !== item.sizeBytes) {
          totalBytes += eventTotal - item.sizeBytes;
          item.sizeBytes = eventTotal;
        }

        const loaded = positiveNumber(event.loaded);
        loadedByFile.set(item.key, item.sizeBytes > 0 ? Math.min(loaded, item.sizeBytes) : loaded);
        const loadedBytes = [...loadedByFile.values()].reduce((sum, value) => sum + value, 0);
        const progress = totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : positiveNumber(event.progress);

        progressCallback({
          ...event,
          progress: Math.max(0, Math.min(100, progress)),
          fileLoadedBytes: loaded,
          fileTotalBytes: item.sizeBytes || eventTotal,
          loadedBytes,
          totalBytes,
          cachedFiles: plan.cachedFiles,
          remainingFiles: plan.files.length,
          totalFiles: plan.totalFiles,
        });
      },
    );
    results.push(result);
  }

  progressCallback({
    status: 'progress',
    progress: 100,
    loadedBytes: totalBytes,
    totalBytes,
    cachedFiles: plan.cachedFiles,
    remainingFiles: plan.files.length,
    totalFiles: plan.totalFiles,
  });

  return { ...publicPlan, totalBytes, results };
}

export async function ensureModelSourceCached(def, options = {}) {
  return ensureModelSourcesCached([def], options);
}
