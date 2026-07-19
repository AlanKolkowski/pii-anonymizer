import { computeServerMac, generateSecret } from './auth.mjs';
import { serializeFrame } from './framing.mjs';
import { createPipeClient } from './pipe-client.mjs';
import { PIPE_PATH_PREFIX } from './pipe-server.mjs';

// MOST-IMPL-PLAN.md §3 M2: the adapter-side ("A") pipe protocol logic, over
// an in-memory fake standing in for a real \\.\pipe\ duplex -- see
// pipe-client.mjs's header for why there is no real socket here.

const PIPE_NAME = PIPE_PATH_PREFIX + 'test-pipe';

/** A standalone, test-driven fake duplex playing the role of "the server":
 * the test calls `_emitData` to push server frames toward the client and
 * inspects `.written` for what the client sent back. */
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

function serverSendHello(fake) {
  const hello = { t: 'hello', nonceS: 'server-nonce-1', proto: 1 };
  fake._emitData(serializeFrame(hello));
  return hello;
}

function completeHandshake(fake, secret) {
  const hello = serverSendHello(fake);
  const authFrame = parsedWritten(fake).at(-1);
  const authOk = { t: 'auth-ok', mac: computeServerMac(secret, authFrame.nonceC, hello.nonceS) };
  fake._emitData(serializeFrame(authOk));
  return { hello, authFrame };
}

describe('construction', () => {
  it('requires readSession and connect', () => {
    expect(() => createPipeClient({ connect: () => {} })).toThrow();
    expect(() => createPipeClient({ readSession: () => {} })).toThrow();
  });
});

describe('session lookup: no caching (§5.2)', () => {
  it('calls readSession() on every connection attempt, not just the first', () => {
    vi.useFakeTimers();
    try {
      const readSession = vi.fn(() => null); // simulate "app not running"
      const connect = vi.fn();
      const client = createPipeClient({ readSession, connect, reconnectDelayMs: 1000 });

      client.start();
      expect(readSession).toHaveBeenCalledTimes(1);
      expect(connect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(readSession).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1000);
      expect(readSession).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to connect to a session pipe path that is not a real \\\\.\\pipe\\ path, without throwing or crashing the retry loop', () => {
    vi.useFakeTimers();
    try {
      const readSession = vi.fn(() => ({ pipe: 'C:\\not\\a\\pipe', secret: generateSecret() }));
      const connect = vi.fn();
      const client = createPipeClient({ readSession, connect, reconnectDelayMs: 1000 });

      expect(() => client.start()).not.toThrow();
      expect(connect).not.toHaveBeenCalled();
      expect(client.getState()).toBe('idle');

      // A tampered/malformed session file must not wedge the retry loop or
      // crash a later attempt either -- it just keeps retrying, same as
      // "no session".
      vi.advanceTimersByTime(1000);
      expect(readSession).toHaveBeenCalledTimes(2);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('handshake — happy path', () => {
  it('replies to hello with a correctly-computed auth frame, then reaches "authenticated" once auth-ok verifies', () => {
    const secret = generateSecret();
    const fake = makeFakeDuplex();
    const onStateChange = vi.fn();
    const client = createPipeClient({
      readSession: () => ({ pipe: PIPE_NAME, secret }),
      connect: () => fake,
      onStateChange,
    });

    client.start();
    expect(client.getState()).toBe('awaiting-hello');

    const hello = serverSendHello(fake);
    expect(client.getState()).toBe('awaiting-auth-ok');
    const authFrame = parsedWritten(fake).at(-1);
    expect(authFrame.t).toBe('auth');
    expect(JSON.stringify(authFrame)).not.toContain(secret); // secret itself never crosses the wire

    fake._emitData(serializeFrame({ t: 'auth-ok', mac: computeServerMac(secret, authFrame.nonceC, hello.nonceS) }));
    expect(client.getState()).toBe('authenticated');
    expect(onStateChange).toHaveBeenCalledWith('authenticated');
  });
});

describe('handshake — impostor server detection (O-3)', () => {
  it('disconnects and never reaches "authenticated" when auth-ok has the wrong MAC, and never sends a tool frame first', () => {
    const secret = generateSecret();
    const fake = makeFakeDuplex();
    const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret }), connect: () => fake });
    client.start();

    const hello = serverSendHello(fake);
    const authFrame = parsedWritten(fake).at(-1);
    // Impostor doesn't know the real secret -- best it can do is a
    // syntactically valid auth-ok computed with a guessed/fabricated one.
    fake._emitData(serializeFrame({ t: 'auth-ok', mac: computeServerMac(generateSecret(), authFrame.nonceC, hello.nonceS) }));

    expect(client.getState()).not.toBe('authenticated');
    expect(fake.isDestroyed()).toBe(true);
    expect(client.sendTool({ t: 'tool', reqId: 'r1', name: 'list_sources', args: {} })).toBe(false);
  });

  it('disconnects if the first frame received is not a hello', () => {
    const fake = makeFakeDuplex();
    const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret: generateSecret() }), connect: () => fake });
    client.start();
    fake._emitData(serializeFrame({ t: 'result', reqId: 'r1', result: {} }));
    expect(fake.isDestroyed()).toBe(true);
  });
});

describe('sendTool / sendCancel gating', () => {
  it('refuses to send (returns false, never throws, never queues) before authentication completes', () => {
    const fake = makeFakeDuplex();
    const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret: generateSecret() }), connect: () => fake });
    client.start();
    expect(client.sendTool({ t: 'tool', reqId: 'r1', name: 'list_sources', args: {} })).toBe(false);
    expect(fake.written).toEqual([]); // handshake writes aside -- nothing sent as a tool frame
  });

  it('sends a tool frame verbatim once authenticated, and a cancel frame the same way', () => {
    const secret = generateSecret();
    const fake = makeFakeDuplex();
    const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret }), connect: () => fake });
    client.start();
    completeHandshake(fake, secret);

    const toolFrame = { t: 'tool', reqId: 'r1', name: 'read_source', args: { id: 's1' }, client: { name: 'x', version: '1' } };
    expect(client.sendTool(toolFrame)).toBe(true);
    expect(parsedWritten(fake).at(-1)).toEqual(toolFrame);

    expect(client.sendCancel({ t: 'cancel', reqId: 'r1' })).toBe(true);
    expect(parsedWritten(fake).at(-1)).toEqual({ t: 'cancel', reqId: 'r1' });
  });
});

describe('result frame delivery', () => {
  it('delivers an authenticated result frame to onResultFrame', () => {
    const secret = generateSecret();
    const fake = makeFakeDuplex();
    const onResultFrame = vi.fn();
    const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret }), connect: () => fake, onResultFrame });
    client.start();
    completeHandshake(fake, secret);

    const resultFrame = { t: 'result', reqId: 'r1', result: { content: [{ type: 'text', text: 'hi' }], isError: false } };
    fake._emitData(serializeFrame(resultFrame));
    expect(onResultFrame).toHaveBeenCalledWith(resultFrame);
  });
});

describe('reconnect on drop (persistent connection, no request queueing)', () => {
  it('reconnects after the authenticated connection drops, re-reading the session file each time, with the reconnect delay honoured', () => {
    vi.useFakeTimers();
    try {
      const secret = generateSecret();
      const fakes = [];
      const connect = vi.fn(() => {
        const f = makeFakeDuplex();
        fakes.push(f);
        return f;
      });
      const readSession = vi.fn(() => ({ pipe: PIPE_NAME, secret }));
      const client = createPipeClient({ readSession, connect, reconnectDelayMs: 1000 });

      client.start();
      expect(connect).toHaveBeenCalledTimes(1);
      completeHandshake(fakes[0], secret);
      expect(client.getState()).toBe('authenticated');

      fakes[0].destroy(); // simulate the pipe dropping
      expect(client.getState()).toBe('idle');
      expect(connect).toHaveBeenCalledTimes(1); // not yet -- waiting for the delay

      vi.advanceTimersByTime(1000);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(readSession).toHaveBeenCalledTimes(2);

      completeHandshake(fakes[1], secret);
      expect(client.getState()).toBe('authenticated');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() prevents further reconnects', () => {
    vi.useFakeTimers();
    try {
      const secret = generateSecret();
      const fakes = [];
      const connect = vi.fn(() => {
        const f = makeFakeDuplex();
        fakes.push(f);
        return f;
      });
      const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret }), connect, reconnectDelayMs: 1000 });

      client.start();
      completeHandshake(fakes[0], secret);
      client.stop();
      expect(client.getState()).toBe('idle');

      vi.advanceTimersByTime(10_000);
      expect(connect).toHaveBeenCalledTimes(1); // never reconnected after stop()
    } finally {
      vi.useRealTimers();
    }
  });
});
