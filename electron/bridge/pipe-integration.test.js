import { generateSecret } from './auth.mjs';
import { buildResultFrame } from './payload-envelope.mjs';
import { createPipeServer, PIPE_PATH_PREFIX } from './pipe-server.mjs';
import { createPipeClient } from './pipe-client.mjs';

// MOST-IMPL-PLAN.md §3 M2, "warstwa integracyjna": pipe-server.mjs and
// pipe-client.mjs wired together over a REAL (if in-memory) connected duplex
// pair -- not two separately-mocked halves. Proves the two independently-
// tested modules actually agree on the wire, end to end: handshake, a full
// tool -> result round trip, and an eavesdropper who knows the pipe exists
// but not the secret.
//
// The pair is a hand-rolled EventEmitter-free duplex (not node:net, not even
// node:stream) -- deliberately minimal, since only the small subset of a
// socket's surface this bridge touches (write/on/destroy) needs to be real
// for this proof; see pipe-server.mjs's header for why a real \\.\pipe\ is a
// separate, BUILD-phase task.

const PIPE_NAME = PIPE_PATH_PREFIX + 'integration-test-pipe';

function createConnectedPair() {
  const sideAListeners = { data: [], close: [], error: [] };
  const sideBListeners = { data: [], close: [], error: [] };
  let destroyed = false;

  function destroyBoth() {
    if (destroyed) return;
    destroyed = true;
    for (const cb of sideAListeners.close.slice()) cb();
    for (const cb of sideBListeners.close.slice()) cb();
  }

  const sideA = {
    written: [],
    write(chunk) {
      this.written.push(chunk);
      if (!destroyed) for (const cb of sideBListeners.data.slice()) cb(chunk);
    },
    destroy: destroyBoth,
    on(event, cb) {
      sideAListeners[event].push(cb);
    },
  };
  const sideB = {
    written: [],
    write(chunk) {
      this.written.push(chunk);
      if (!destroyed) for (const cb of sideAListeners.data.slice()) cb(chunk);
    },
    destroy: destroyBoth,
    on(event, cb) {
      sideBListeners[event].push(cb);
    },
  };
  return { serverSide: sideA, clientSide: sideB, isDestroyed: () => destroyed };
}

/** A second, UNPAIRED fake for the eavesdropper scenario: it knows nothing
 * except that it can open a raw connection to the server -- there is no
 * legitimate client logic behind it, only whatever the test injects. */
function makeUnpairedDuplex() {
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

describe('server + client wired together on one connected pair', () => {
  it('completes the handshake synchronously once the client is started and the server accepts the pair', () => {
    const secret = generateSecret();
    const { serverSide, clientSide } = createConnectedPair();

    const server = createPipeServer({ pipeName: PIPE_NAME, secret });
    const client = createPipeClient({
      readSession: () => ({ pipe: PIPE_NAME, secret }),
      connect: () => clientSide,
    });

    client.start(); // registers the client's data listener first
    server.acceptConnection(serverSide); // ...then the server writes `hello`

    expect(client.getState()).toBe('authenticated');
    expect(server.getStatus().connectionCount).toBe(1);
  });

  it('round-trips a tool call to a result end to end (client sendTool -> server onToolFrame -> handle.sendResult -> client onResultFrame)', () => {
    const secret = generateSecret();
    const { serverSide, clientSide } = createConnectedPair();

    const onToolFrame = vi.fn((frame, handle) => {
      handle.sendResult(buildResultFrame(frame.reqId, `echo:${frame.name}`));
    });
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, onToolFrame });

    const onResultFrame = vi.fn();
    const client = createPipeClient({
      readSession: () => ({ pipe: PIPE_NAME, secret }),
      connect: () => clientSide,
      onResultFrame,
    });

    client.start();
    server.acceptConnection(serverSide);
    expect(client.getState()).toBe('authenticated');

    const sent = client.sendTool({
      t: 'tool',
      reqId: 'r-integration-1',
      name: 'read_source',
      args: { id: 's1' },
      client: { name: 'Test Client', version: '1.0' },
    });
    expect(sent).toBe(true);

    expect(onToolFrame).toHaveBeenCalledTimes(1);
    expect(onResultFrame).toHaveBeenCalledWith(
      buildResultFrame('r-integration-1', 'echo:read_source'),
    );
  });

  it('propagates a cancel frame from client to server', () => {
    const secret = generateSecret();
    const { serverSide, clientSide } = createConnectedPair();
    const onCancelFrame = vi.fn();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret, onCancelFrame });
    const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret }), connect: () => clientSide });

    client.start();
    server.acceptConnection(serverSide);
    client.sendCancel({ t: 'cancel', reqId: 'r-integration-2' });

    expect(onCancelFrame).toHaveBeenCalledWith(expect.objectContaining({ t: 'cancel', reqId: 'r-integration-2' }), expect.any(Object));
  });
});

describe('eavesdropper: knows the pipe exists, does not know the secret', () => {
  it('receives hello then gets disconnected on its first (necessarily invalid) attempt, and the secret never appears on any wire the test can observe', () => {
    const secret = generateSecret();
    const { serverSide, clientSide } = createConnectedPair();
    const server = createPipeServer({ pipeName: PIPE_NAME, secret });
    const client = createPipeClient({ readSession: () => ({ pipe: PIPE_NAME, secret }), connect: () => clientSide });

    client.start();
    server.acceptConnection(serverSide);
    expect(client.getState()).toBe('authenticated');

    // A third party dials the same server without the secret -- the ONLY
    // thing it could plausibly know is the pipe's existence (the name is in
    // the session file it does not have read access to in the real product,
    // but the pipe namespace itself is not access-controlled by Windows).
    const eavesdropper = makeUnpairedDuplex();
    server.acceptConnection(eavesdropper);
    expect(eavesdropper.written).toHaveLength(1); // got a hello, same as anyone
    const hello = JSON.parse(eavesdropper.written[0]);
    expect(hello.t).toBe('hello');

    eavesdropper._emitData(JSON.stringify({ t: 'auth', nonceC: 'guess', mac: 'guess' }) + '\n');
    expect(eavesdropper.isDestroyed()).toBe(true);
    expect(server.getStatus().connectionCount).toBe(1); // only the legitimate client remains

    for (const line of [...serverSide.written, ...clientSide.written, ...eavesdropper.written]) {
      expect(line).not.toContain(secret);
    }
  });
});
