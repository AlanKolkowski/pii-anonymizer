// Chromium-based browsers (Chrome, Edge) exempt pages that hold a Web Lock
// from tab freezing / Edge sleeping tabs and from intensive background timer
// throttling. Holding a lock for the duration of a long job (OCR import,
// anonymization batch) keeps it running when the user switches tabs.
//
// The lock is a keep-alive signal only — nothing in the app contends on it,
// so shared mode lets overlapping jobs hold it concurrently.

/**
 * Acquire a shared Web Lock and return a release function. No-op (returns a
 * callable release) where the Web Locks API is unavailable. Safe to call the
 * release function more than once.
 */
export function holdBackgroundLock(name, locks = globalThis.navigator?.locks) {
  if (typeof locks?.request !== 'function') return () => {};
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  // Swallow rejections: the lock is best-effort (e.g. the page may be
  // unloading, which releases locks anyway).
  try {
    locks.request(name, { mode: 'shared' }, () => held).catch(() => {});
  } catch {
    return () => {};
  }
  return release;
}
