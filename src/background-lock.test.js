import { holdBackgroundLock } from './background-lock.js';

function fakeLocks() {
  const calls = [];
  return {
    calls,
    api: {
      request(name, options, callback) {
        const entry = { name, options, released: false };
        calls.push(entry);
        return Promise.resolve(callback()).then(() => { entry.released = true; });
      },
    },
  };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('holdBackgroundLock', () => {
  it('holds a shared lock until released', async () => {
    const { calls, api } = fakeLocks();
    const release = holdBackgroundLock('pii-job', api);
    expect(calls).toEqual([
      expect.objectContaining({ name: 'pii-job', options: { mode: 'shared' } }),
    ]);
    await settle();
    expect(calls[0].released).toBe(false);
    release();
    await settle();
    expect(calls[0].released).toBe(true);
  });

  it('tolerates double release', async () => {
    const { calls, api } = fakeLocks();
    const release = holdBackgroundLock('pii-job', api);
    release();
    release();
    await settle();
    expect(calls[0].released).toBe(true);
  });

  it('is a no-op without the Web Locks API', () => {
    expect(() => holdBackgroundLock('pii-job', undefined)()).not.toThrow();
    expect(() => holdBackgroundLock('pii-job', {})()).not.toThrow();
  });

  it('is a no-op when the request call itself throws', () => {
    const api = { request() { throw new Error('denied'); } };
    expect(() => holdBackgroundLock('pii-job', api)()).not.toThrow();
  });

  it('swallows a rejected lock request', async () => {
    const api = { request: () => Promise.reject(new Error('unloading')) };
    const release = holdBackgroundLock('pii-job', api);
    await settle();
    release();
  });
});
