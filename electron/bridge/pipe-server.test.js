import { computeClientMac, generateNonce, generateSecret } from './auth.mjs';
import { serializeFrame } from './framing.mjs';
import { assertPipePath, createPipeServer, PIPE_PATH_PREFIX } from './pipe-server.mjs';

// MOST-IMPL-PLAN.md §3 M2: connection lifecycle + auth handshake + tool/
// result/cancel frame exchange, over an in-memory fake standing in for a
// real \\.\pipe\ duplex. The real named-pipe transport is a BUILD-phase
// task (see pipe-server.mjs's header); this suite proves the LOGIC that
// will sit underneath it, entirely without a socket.

const PIPE_NAME = PIPE_PATH_PREFIX + 'test-pipe';

/** A standalone, test-driven fake duplex: `_emitData` simulates bytes
 * arriving from the remote peer; `.written` captures every serialized frame
 * this module wrote back. Not connected to any other fake -- for tests that
 * drive one side of the protocol directly (pipe-server in isolation). */
function makeFakeDuplex() {
  const listeners = { data: [], close: [], error: [] };
  let destroyed = false;
  return {
    written: [],
    isDestroyed: () => destroyed,
    write(chunk) {
      if (!destroyed) this.written.push(chunk);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const cb of listeners.close.slice()) cb();
    },
    on(event, cb) {
      listeners[event].push(cb);
    },
    _emitData(chunk) {
      for (const cb of listeners.data.slice()) cb(chunk);
    },
  };
}

function parsedWritten(fake) {
  return fake.written.map((line) => JSON.parse(line));
}

function makeAuthedConnection(server, { secret }) {
  const d = makeFakeDuplex();
  server.acceptConnection(d);
  const hello = parsedWritten(d)[0];
  const nonceC = generateNonce();
  const mac = computeClientMac(secret, hello.nonceS, nonceC);
  d._emitData(serializeFrame({ t: 'auth', nonceC, mac }));
  return d;
}

describe('assertPipePath', () => {
  it('accepts a well-formed \\\\.\\pipe\\ path', () => {
    expect(() => assertPipePath(PIPE_NAME)).not.toThrow();
  });

  it.each([undefined, null, 123, '', 'C:\\not\\a\\pipe', '\\\\server\\share', '\\\\.\\PIPE\\wrong-case'])(
    'rejects %p',
    (bad) => {
      expect(() => assertPipePath(bad)).toThrow();
    },
  );
});

describe('createPipeServer construction', () => {
  it('throws immediately for a non-pipe pipeName -- before any connection is ever accepted', () => {
    expect(() => createPipeServer({ pipeName: 'not-a-pipe', secret: generateSecret() })).toThrow();
  });

  it('requires a secret', () => {
    expect(() => createPipeServer({ pipeName: PIPE_NAME })).toThrow();
  });
});

describe('handshake — happy path', () => {
  it('sends hello on accept, then auth-ok once the client MAC verifies, and counts the connection', () => {
    const secret = generateSecret();
    const onConnectionCountChange = vi.fn();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, onConnectionCountChange });

    const d = makeFakeDuplex();
    const handle = server.acceptConnection(d);
    expect(handle).not.toBeNull();
    expect(parsedWritten(d)).toEqual([{ t: 'hello', nonceS: expect.any(String), proto: 1 }]);

    const hello = parsedWritten(d)[0];
    const nonceC = generateNonce();
    d._emitData(serializeFrame({ t: 'auth', nonceC, mac: computeClientMac(secret, hello.nonceS, nonceC) }));

    expect(parsedWritten(d)).toHaveLength(2);
    expect(parsedWritten(d)[1].t).toBe('auth-ok');
    expect(server.getStatus()).toMatchObject({ connectionCount: 1 });
    expect(onConnectionCountChange).toHaveBeenLastCalledWith(1);
  });
});

describe('handshake — rejection paths', () => {
  it('disconnects on a wrong MAC without ever reaching authenticated state', () => {
    const secret = generateSecret();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret });
    const d = makeFakeDuplex();
    server.acceptConnection(d);
    const hello = parsedWritten(d)[0];

    d._emitData(serializeFrame({ t: 'auth', nonceC: 'x', mac: 'wrong-mac' }));

    expect(d.isDestroyed()).toBe(true);
    expect(server.getStatus().connectionCount).toBe(0);
  });

  it('disconnects when the first frame is not an auth frame', () => {
    const server = createPipeServer({ pipeName: PIPE_NAME, secret: generateSecret() });
    const d = makeFakeDuplex();
    server.acceptConnection(d);
    d._emitData(serializeFrame({ t: 'tool', reqId: 'r1', name: 'read_source', args: {} }));
    expect(d.isDestroyed()).toBe(true);
  });

  it('never includes the secret in any byte written to any connection (eavesdropper cannot recover it from the wire)', () => {
    const secret = generateSecret();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret });
    const good = makeAuthedConnection(server, { secret });
    const bad = makeFakeDuplex();
    server.acceptConnection(bad);
    bad._emitData(serializeFrame({ t: 'auth', nonceC: 'x', mac: 'wrong' }));

    for (const line of [...good.written, ...bad.written]) {
      expect(line).not.toContain(secret);
    }
  });

  it('times out an unauthenticated connection after handshakeTimeoutMs (fake timers)', () => {
    vi.useFakeTimers();
    try {
      const server = createPipeServer({ pipeName: PIPE_NAME, secret: generateSecret(), handshakeTimeoutMs: 5000 });
      const d = makeFakeDuplex();
      server.acceptConnection(d);
      expect(d.isDestroyed()).toBe(false);
      vi.advanceTimersByTime(5000);
      expect(d.isDestroyed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out a connection that authenticated before the handshake timer fired', () => {
    vi.useFakeTimers();
    try {
      const secret = generateSecret();
      const server = createPipeServer({ pipeName: PIPE_NAME, secret, handshakeTimeoutMs: 5000 });
      const d = makeAuthedConnection(server, { secret });
      vi.advanceTimersByTime(5000);
      expect(d.isDestroyed()).toBe(false);
      expect(server.getStatus().connectionCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('throttle after a failed auth (1s window, applies to NEW connection attempts globally)', () => {
  it('immediately destroys a brand-new connection attempt started within the throttle window', () => {
    vi.useFakeTimers();
    try {
      const secret = generateSecret();
      const server = createPipeServer({ pipeName: PIPE_NAME, secret, throttleMs: 1000 });
      const attacker = makeFakeDuplex();
      server.acceptConnection(attacker);
      attacker._emitData(serializeFrame({ t: 'auth', nonceC: 'x', mac: 'wrong' }));
      expect(attacker.isDestroyed()).toBe(true);

      const nextComer = makeFakeDuplex();
      const handle = server.acceptConnection(nextComer);
      expect(handle).toBeNull();
      expect(nextComer.isDestroyed()).toBe(true);
      expect(nextComer.written).toEqual([]); // never even got a hello
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a new connection again once the throttle window has elapsed', () => {
    vi.useFakeTimers();
    try {
      const secret = generateSecret();
      const server = createPipeServer({ pipeName: PIPE_NAME, secret, throttleMs: 1000 });
      const attacker = makeFakeDuplex();
      server.acceptConnection(attacker);
      attacker._emitData(serializeFrame({ t: 'auth', nonceC: 'x', mac: 'wrong' }));

      vi.advanceTimersByTime(1001);
      const nextComer = makeFakeDuplex();
      const handle = server.acceptConnection(nextComer);
      expect(handle).not.toBeNull();
      expect(nextComer.written).toHaveLength(1); // got its hello
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('connection limit (max 4 authenticated connections)', () => {
  it('rejects a 5th authenticated attempt with an error frame + disconnect, without affecting the existing 4', () => {
    const secret = generateSecret();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, maxConnections: 4, throttleMs: 0 });
    const established = Array.from({ length: 4 }, () => makeAuthedConnection(server, { secret }));
    expect(server.getStatus().connectionCount).toBe(4);

    const fifth = makeFakeDuplex();
    const handle = server.acceptConnection(fifth);
    expect(handle).toBeNull();
    expect(fifth.isDestroyed()).toBe(true);
    expect(parsedWritten(fifth)).toEqual([{ t: 'error', reason: 'too-many-connections' }]);

    expect(server.getStatus().connectionCount).toBe(4);
    for (const d of established) expect(d.isDestroyed()).toBe(false);
  });
});

describe('tool / cancel frame exchange (post-auth)', () => {
  it('forwards a tool frame to onToolFrame with the connection handle, and sendResult writes back a result frame', () => {
    const secret = generateSecret();
    const onToolFrame = vi.fn((frame, handle) => {
      handle.sendResult({ t: 'result', reqId: frame.reqId, result: { content: [{ type: 'text', text: 'ok' }], isError: false } });
    });
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, onToolFrame });
    const d = makeAuthedConnection(server, { secret });

    d._emitData(serializeFrame({ t: 'tool', reqId: 'r1', name: 'read_source', args: { id: 's1' }, client: { name: 'x', version: '1' } }));

    expect(onToolFrame).toHaveBeenCalledTimes(1);
    expect(onToolFrame.mock.calls[0][0]).toMatchObject({ t: 'tool', reqId: 'r1', name: 'read_source' });
    expect(parsedWritten(d).at(-1)).toEqual({ t: 'result', reqId: 'r1', result: { content: [{ type: 'text', text: 'ok' }], isError: false } });
  });

  it('forwards a cancel frame to onCancelFrame', () => {
    const secret = generateSecret();
    const onCancelFrame = vi.fn();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, onCancelFrame });
    const d = makeAuthedConnection(server, { secret });

    d._emitData(serializeFrame({ t: 'cancel', reqId: 'r1' }));
    expect(onCancelFrame).toHaveBeenCalledWith(expect.objectContaining({ t: 'cancel', reqId: 'r1' }), expect.any(Object));
  });

  it('sendResult is a silent no-op once the connection has already closed', () => {
    const secret = generateSecret();
    let savedHandle;
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, onToolFrame: (_f, h) => { savedHandle = h; } });
    const d = makeAuthedConnection(server, { secret });
    d._emitData(serializeFrame({ t: 'tool', reqId: 'r1', name: 'list_sources', args: {} }));

    d.destroy();
    expect(() => savedHandle.sendResult({ t: 'result', reqId: 'r1', result: { content: [{ type: 'text', text: 'x' }], isError: false } })).not.toThrow();
  });
});

describe('connection lifecycle notifications', () => {
  it('calls onConnectionClosed with {authenticated:true} for an authenticated connection that later closes', () => {
    const secret = generateSecret();
    const onConnectionClosed = vi.fn();
    const onConnectionCountChange = vi.fn();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, onConnectionClosed, onConnectionCountChange });
    const d = makeAuthedConnection(server, { secret });

    d.destroy();
    expect(onConnectionClosed).toHaveBeenCalledWith(expect.any(Object), { authenticated: true });
    expect(onConnectionCountChange).toHaveBeenLastCalledWith(0);
  });

  it('calls onConnectionClosed with {authenticated:false} for a connection that closes mid-handshake', () => {
    const onConnectionClosed = vi.fn();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret: generateSecret(), onConnectionClosed });
    const d = makeFakeDuplex();
    server.acceptConnection(d);
    d.destroy();
    expect(onConnectionClosed).toHaveBeenCalledWith(expect.any(Object), { authenticated: false });
  });

  it('closeAll() disconnects every authenticated connection', () => {
    const secret = generateSecret();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret });
    const a = makeAuthedConnection(server, { secret });
    const b = makeAuthedConnection(server, { secret });
    server.closeAll();
    expect(a.isDestroyed()).toBe(true);
    expect(b.isDestroyed()).toBe(true);
    expect(server.getStatus().connectionCount).toBe(0);
  });
});

describe('no idle-disconnect once authenticated ("keep-alive" of a long-pending tool call)', () => {
  it('an authenticated connection stays open across a long idle period with no result yet sent', () => {
    vi.useFakeTimers();
    try {
      const secret = generateSecret();
      const server = createPipeServer({ pipeName: PIPE_NAME, secret, handshakeTimeoutMs: 5000 });
      const d = makeAuthedConnection(server, { secret });
      d._emitData(serializeFrame({ t: 'tool', reqId: 'r1', name: 'list_sources', args: {} }));

      vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes of silence, e.g. a slow human gate decision
      expect(d.isDestroyed()).toBe(false);
      expect(server.getStatus().connectionCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getStatus never exposes payload content', () => {
  it('has no field carrying anything resembling submitted args/text', () => {
    const secret = generateSecret();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret });
    const d = makeAuthedConnection(server, { secret });
    d._emitData(serializeFrame({ t: 'tool', reqId: 'r1', name: 'read_source', args: { id: 'CANARY-SECRET-ID' } }));
    expect(JSON.stringify(server.getStatus())).not.toContain('CANARY-SECRET-ID');
  });
});
