import { createGateQueue } from './gate-queue.mjs';

// MOST-IMPL-PLAN.md §3 M3, MCP-BRIDGE-DESIGN.md §6.1/§6.4/§6.5: the human
// approval workflow, as a pure state machine — no Electron, no
// BrowserWindow, no IPC. `onOpen`/`onClose` are the only side-effecting
// hooks; a real electron/bridge/gate.mjs (BUILD phase) would implement them
// by creating/closing an actual gate window. Timeout is an explicit
// constructor argument here (P-7: never an env var — that would be a
// timeout-manipulation vector in production), so tests can pass a short
// value directly instead of waiting out the real 180 s.

function req(overrides = {}) {
  return { reqId: 'r1', name: 'read_source', args: { id: 's1' }, client: 'Test Client', payload: 'payload', ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('single request happy path', () => {
  it('opens exactly one gate and resolves "approved" on decide(reqId, true)', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const queue = createGateQueue({ onOpen, onClose });

    const pending = queue.submit(req());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ reqId: 'r1', name: 'read_source' }));

    expect(queue.decide('r1', true)).toBe(true);
    await expect(pending).resolves.toEqual({ outcome: 'approved', reqId: 'r1' });
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ reqId: 'r1' }), expect.objectContaining({ outcome: 'approved' }));
    expect(queue.getStatus()).toMatchObject({ state: 'idle', pendingCount: 0, approved: 1, rejected: 0 });
  });

  it('resolves "rejected" on decide(reqId, false)', async () => {
    const queue = createGateQueue();
    const pending = queue.submit(req());
    queue.decide('r1', false);
    await expect(pending).resolves.toEqual({ outcome: 'rejected', reqId: 'r1' });
    expect(queue.getStatus()).toMatchObject({ rejected: 1, approved: 0 });
  });

  it('ignores a decide() for a reqId that is not the currently-open one (R-5: decisions bind to the pending reqId only)', async () => {
    const queue = createGateQueue();
    const pending = queue.submit(req());
    expect(queue.decide('someone-elses-reqid', true)).toBe(false);
    queue.decide('r1', true);
    await expect(pending).resolves.toMatchObject({ outcome: 'approved' });
  });

  it('decide() on an empty queue is a no-op, never throws', () => {
    const queue = createGateQueue();
    expect(queue.decide('nothing-pending', true)).toBe(false);
  });
});

describe('one window on screen at a time (FIFO)', () => {
  it('only calls onOpen for the head; the next request opens only after the first is decided', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen });

    const p1 = queue.submit(req({ reqId: 'r1', args: { id: 's1' } }));
    const p2 = queue.submit(req({ reqId: 'r2', args: { id: 's2' } }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ reqId: 'r1' }));

    queue.decide('r1', true);
    await p1;
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ reqId: 'r2' }));

    queue.decide('r2', true);
    await expect(p2).resolves.toMatchObject({ outcome: 'approved' });
  });
});

describe('queue capacity (§6.5: max 5 pending)', () => {
  it('rejects a 6th distinct request immediately with queue-full, without ever opening a window for it', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen, maxPending: 5 });

    for (let i = 0; i < 5; i++) {
      queue.submit(req({ reqId: `r${i}`, args: { id: `s${i}` } }));
    }
    expect(onOpen).toHaveBeenCalledTimes(1); // only the head is open; 4 wait queued

    const overflow = await queue.submit(req({ reqId: 'r-overflow', args: { id: 'overflow' } }));
    expect(overflow).toEqual({ outcome: 'queue-full', reqId: 'r-overflow' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('cisza po odmowie (silence after rejection, §6.5)', () => {
  it('auto-denies an identical request within the silence window, without opening a window', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen, silenceWindowMs: 60_000 });

    const first = queue.submit(req({ reqId: 'r1' }));
    queue.decide('r1', false);
    await first;
    expect(onOpen).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000); // well inside the 60s window
    const repeat = await queue.submit(req({ reqId: 'r2' })); // same name+args
    expect(repeat).toEqual({ outcome: 'auto-denied', reqId: 'r2' });
    expect(onOpen).toHaveBeenCalledTimes(1); // still just once
    expect(queue.getStatus().autoDenied).toBe(1);
  });

  it('opens a fresh gate again once the silence window has elapsed', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen, silenceWindowMs: 60_000 });

    const first = queue.submit(req({ reqId: 'r1' }));
    queue.decide('r1', false);
    await first;

    vi.advanceTimersByTime(60_001);
    queue.submit(req({ reqId: 'r2' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('does not silence a DIFFERENT request (different args) after a rejection', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen });
    const first = queue.submit(req({ reqId: 'r1', args: { id: 's1' } }));
    queue.decide('r1', false);
    await first;

    queue.submit(req({ reqId: 'r2', args: { id: 's2' } }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('duplicate pending request (§6.5: attaches to the same decision)', () => {
  it('a second submission with the same name+args while the first is still open shares one decision, each keeping its own reqId', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen });

    const p1 = queue.submit(req({ reqId: 'r1', args: { id: 's1' } }));
    const p2 = queue.submit(req({ reqId: 'r2', args: { id: 's1' } })); // identical args, different reqId
    expect(onOpen).toHaveBeenCalledTimes(1); // no second window

    queue.decide('r1', true);
    await expect(p1).resolves.toEqual({ outcome: 'approved', reqId: 'r1' });
    await expect(p2).resolves.toEqual({ outcome: 'approved', reqId: 'r2' });
    expect(queue.getStatus().approved).toBe(1); // one decision, not two
  });
});

describe('timeout (decyzja 5: 180s, fail-closed)', () => {
  it('resolves "timeout" when no decision arrives in time, then opens the next queued item', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen, timeoutMs: 180_000 });

    const p1 = queue.submit(req({ reqId: 'r1', args: { id: 's1' } }));
    const p2 = queue.submit(req({ reqId: 'r2', args: { id: 's2' } }));

    vi.advanceTimersByTime(180_000);
    await expect(p1).resolves.toEqual({ outcome: 'timeout', reqId: 'r1' });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ reqId: 'r2' }));
    expect(queue.getStatus().timedOut).toBe(1);

    queue.decide('r2', true);
    await expect(p2).resolves.toMatchObject({ outcome: 'approved' });
  });

  it('does NOT arm the silence window on a timeout (only an explicit Odrzuć does, per §6.5)', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen, timeoutMs: 1000 });
    const p1 = queue.submit(req({ reqId: 'r1' }));
    vi.advanceTimersByTime(1000);
    await p1;

    queue.submit(req({ reqId: 'r2' })); // identical name+args, right after the timeout
    expect(onOpen).toHaveBeenCalledTimes(2); // a fresh gate opens, not an auto-denial
  });
});

describe('cancel (client-initiated, MCP notifications/cancelled)', () => {
  it('cancels a still-queued (not yet open) request without ever opening a window for it', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen });
    queue.submit(req({ reqId: 'r1', args: { id: 's1' } }));
    const p2 = queue.submit(req({ reqId: 'r2', args: { id: 's2' } }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    expect(queue.cancel('r2')).toBe(true);
    await expect(p2).resolves.toEqual({ outcome: 'cancelled', reqId: 'r2' });
    expect(onOpen).toHaveBeenCalledTimes(1); // never opened
  });

  it('cancels the currently-open request and closes its window with an annotation', async () => {
    const onClose = vi.fn();
    const queue = createGateQueue({ onClose });
    const p1 = queue.submit(req({ reqId: 'r1' }));

    expect(queue.cancel('r1')).toBe(true);
    await expect(p1).resolves.toEqual({ outcome: 'cancelled', reqId: 'r1' });
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ reqId: 'r1' }), expect.objectContaining({ outcome: 'cancelled' }));
  });

  it('cancelling one of several attached waiters only resolves that one; the shared decision still lands normally for the rest', async () => {
    const onOpen = vi.fn();
    const queue = createGateQueue({ onOpen });
    const p1 = queue.submit(req({ reqId: 'r1', args: { id: 's1' } }));
    const p2 = queue.submit(req({ reqId: 'r2', args: { id: 's1' } })); // attaches to r1's entry

    expect(queue.cancel('r2')).toBe(true);
    await expect(p2).resolves.toEqual({ outcome: 'cancelled', reqId: 'r2' });
    expect(onOpen).toHaveBeenCalledTimes(1); // r1's window is still open, untouched

    queue.decide('r1', true);
    await expect(p1).resolves.toEqual({ outcome: 'approved', reqId: 'r1' });
  });

  it('returns false for an unknown reqId', () => {
    const queue = createGateQueue();
    expect(queue.cancel('nope')).toBe(false);
  });
});

describe('pauseAll (bridge paused / app exiting: auto-reject everything)', () => {
  it('rejects the open request and every queued one, and does not arm the silence window', async () => {
    const onClose = vi.fn();
    const queue = createGateQueue({ onClose });
    const p1 = queue.submit(req({ reqId: 'r1', args: { id: 's1' } }));
    const p2 = queue.submit(req({ reqId: 'r2', args: { id: 's2' } }));
    const p3 = queue.submit(req({ reqId: 'r3', args: { id: 's3' } }));

    queue.pauseAll('bridge-paused');

    await expect(p1).resolves.toEqual({ outcome: 'rejected', reqId: 'r1', reason: 'bridge-paused' });
    await expect(p2).resolves.toEqual({ outcome: 'rejected', reqId: 'r2', reason: 'bridge-paused' });
    await expect(p3).resolves.toEqual({ outcome: 'rejected', reqId: 'r3', reason: 'bridge-paused' });
    expect(onClose).toHaveBeenCalledTimes(1); // only r1 ever had a window open

    const status = queue.getStatus();
    expect(status).toMatchObject({ state: 'idle', pendingCount: 0, rejected: 3 });

    // Not a targeted "Odrzuć" — an identical request right after must open a
    // fresh gate, not get silently auto-denied.
    const onOpen = vi.fn();
    const queue2 = createGateQueue({ onOpen });
    const before = queue2.submit(req({ reqId: 'x1', args: { id: 's1' } }));
    queue2.pauseAll();
    await before;
    queue2.submit(req({ reqId: 'x2', args: { id: 's1' } }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('is a no-op on an already-empty queue', () => {
    const queue = createGateQueue();
    expect(() => queue.pauseAll()).not.toThrow();
    expect(queue.getStatus()).toMatchObject({ state: 'idle', pendingCount: 0 });
  });
});

describe('getStatus never exposes payload content (only metadata/counters)', () => {
  it('has no field carrying the submitted payload text', async () => {
    const queue = createGateQueue();
    queue.submit(req({ payload: 'CANARY-SECRET-PAYLOAD-TEXT' }));
    expect(JSON.stringify(queue.getStatus())).not.toContain('CANARY-SECRET-PAYLOAD-TEXT');
  });
});
