import { describe, it, expect } from 'vitest';

async function loadCacheFactory() {
  let mod;
  try {
    mod = await import('./worker-cache.js');
  } catch (err) {
    throw new Error(
      `Expected src/worker-cache.js to export createBoundedNerCache(maxEntries); import failed: ${err.message}`,
    );
  }

  if (typeof mod.createBoundedNerCache !== 'function') {
    throw new Error('Expected src/worker-cache.js to export createBoundedNerCache(maxEntries)');
  }

  return mod.createBoundedNerCache;
}

async function createCache(maxEntries) {
  const createBoundedNerCache = await loadCacheFactory();
  return createBoundedNerCache(maxEntries);
}

describe('createBoundedNerCache', () => {
  it('evicts the oldest entry when max entries is exceeded', async () => {
    const cache = await createCache(2);

    cache.set('doc-a', { entities: ['a'] });
    cache.set('doc-b', { entities: ['b'] });
    cache.set('doc-c', { entities: ['c'] });

    expect(cache.get('doc-a')).toBeUndefined();
    expect(cache.get('doc-b')).toEqual({ entities: ['b'] });
    expect(cache.get('doc-c')).toEqual({ entities: ['c'] });
    expect(cache.size).toBe(2);
  });

  it('refreshes recency when an entry is read', async () => {
    const cache = await createCache(2);

    cache.set('doc-a', { entities: ['a'] });
    cache.set('doc-b', { entities: ['b'] });
    expect(cache.get('doc-a')).toEqual({ entities: ['a'] });
    cache.set('doc-c', { entities: ['c'] });

    expect(cache.get('doc-a')).toEqual({ entities: ['a'] });
    expect(cache.get('doc-b')).toBeUndefined();
    expect(cache.get('doc-c')).toEqual({ entities: ['c'] });
    expect(cache.size).toBe(2);
  });

  it('supports explicit entry removal and full clearing', async () => {
    const cache = await createCache(3);

    cache.set('doc-a', { entities: ['a'] });
    cache.set('doc-b', { entities: ['b'] });
    expect(cache.delete('doc-a')).toBe(true);
    expect(cache.get('doc-a')).toBeUndefined();
    expect(cache.get('doc-b')).toEqual({ entities: ['b'] });

    cache.clear();
    expect(cache.get('doc-b')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
