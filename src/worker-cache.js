export function createBoundedNerCache(maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('maxEntries must be a positive integer');
  }

  const entries = new Map();

  function refresh(key, value) {
    entries.delete(key);
    entries.set(key, value);
  }

  return {
    get size() {
      return entries.size;
    },
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      refresh(key, value);
      return value;
    },
    set(key, value) {
      refresh(key, value);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        entries.delete(oldestKey);
      }
      return this;
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
