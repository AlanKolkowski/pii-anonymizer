import { createSerialQueue } from './serial-queue.js';

describe('createSerialQueue', () => {
  it('runs enqueued tasks strictly in FIFO order', async () => {
    const enqueue = createSerialQueue();
    const order = [];

    let resolveFirst;
    const firstStarted = vi.fn();
    const secondStarted = vi.fn();

    enqueue(() => {
      firstStarted();
      order.push('first:start');
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    });

    const second = enqueue(() => {
      secondStarted();
      order.push('second:start');
      return Promise.resolve('second-done');
    });

    // Drain the microtask queue so the first task is dispatched.
    await Promise.resolve();
    expect(firstStarted).toHaveBeenCalledTimes(1);
    expect(secondStarted).not.toHaveBeenCalled();

    resolveFirst();
    const result = await second;

    expect(secondStarted).toHaveBeenCalledTimes(1);
    expect(result).toBe('second-done');
    expect(order).toEqual(['first:start', 'second:start']);
  });

  it('propagates a rejecting task to its caller without blocking later tasks', async () => {
    const enqueue = createSerialQueue();
    const secondRan = vi.fn();

    const first = enqueue(() => Promise.reject(new Error('boom')));
    // Yield so the rejection is processed before the second task enqueues behind
    // it on the chain.
    await Promise.resolve();
    const second = enqueue(() => {
      secondRan();
      return Promise.resolve('ok');
    });

    await expect(first).rejects.toThrow('boom');
    expect(await second).toBe('ok');
    expect(secondRan).toHaveBeenCalledTimes(1);
  });
});
