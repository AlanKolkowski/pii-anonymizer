// Pipe-client LOGIC: the adapter side ("A" in the M2 frame table) of the
// bridge's own application protocol, over an INJECTED duplex-like transport
// (MOST-IMPL-PLAN.md §3 M2). Same seam and same scope note as
// pipe-server.mjs: the real `net.connect('\\.\pipe\...')` wiring is a
// follow-up BUILD-phase change; this module never imports a networking
// module.
//
// Responsibilities per §3 M2 / §5.2 of MCP-BRIDGE-DESIGN.md:
//   - reads the session file at EVERY connection attempt via the injected
//     `readSession()` -- never caches the pipe name/secret, because the app
//     may have restarted with a fresh pipe name and secret since the last
//     attempt;
//   - performs the client half of the auth.mjs handshake and verifies the
//     server's auth-ok BEFORE ever sending a tool/cancel frame -- this is
//     what lets a legitimate client detect and disconnect from an impostor
//     server before any payload-carrying frame is ever put on the wire;
//   - maintains one persistent logical connection with reconnect-on-drop;
//   - never queues requests itself (MOST-IMPL-PLAN.md §3 M2: "zero
//     kolejkowania") -- that discipline belongs to gate-queue.mjs, one layer
//     up in the finished product.
import { clientCreateAuth, clientVerifyAuthOk } from './auth.mjs';
import { serializeFrame, createFrameParser } from './framing.mjs';
import { assertPipePath } from './pipe-server.mjs';

const DEFAULT_RECONNECT_DELAY_MS = 1000;
const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * @param {object} options
 * @param {() => ({pipe: string, secret: string} | null)} options.readSession -
 *   wraps session-file.mjs's readSessionFile for the configured directory;
 *   returning null means "no session" (app not running / bridge paused, R-1)
 *   and is treated as a transient condition worth retrying, not a fatal one.
 * @param {(pipeName: string) => object} options.connect - injected transport
 *   seam: returns a duplex-like object for the given pipe path. May throw
 *   (treated the same as an immediate disconnect).
 * @param {number} [options.reconnectDelayMs]
 * @param {number} [options.maxFrameBytes]
 * @param {typeof setTimeout} [options.setTimeoutFn]
 * @param {typeof clearTimeout} [options.clearTimeoutFn]
 * @param {(state: 'idle'|'connecting'|'awaiting-hello'|'awaiting-auth-ok'|'authenticated') => void} [options.onStateChange]
 * @param {(frame: object) => void} [options.onResultFrame] - an authenticated
 *   server sent {t:'result', reqId, result}.
 */
export function createPipeClient({
  readSession,
  connect,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onStateChange = () => {},
  onResultFrame = () => {},
}) {
  if (typeof readSession !== 'function') throw new Error('createPipeClient requires readSession');
  if (typeof connect !== 'function') throw new Error('createPipeClient requires connect');

  let stopped = true;
  let duplex = null;
  let stage = 'idle';
  let reconnectTimer = null;
  let currentSecret = null;

  function setStage(next) {
    stage = next;
    onStateChange(next);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    clearReconnectTimer();
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connectOnce();
    }, reconnectDelayMs);
  }

  function teardown() {
    duplex = null;
    currentSecret = null;
    setStage('idle');
    scheduleReconnect();
  }

  function connectOnce() {
    if (stopped) return;

    // §5.2: read the session file at EVERY attempt -- never cached.
    let session;
    try {
      session = readSession();
    } catch {
      session = null;
    }
    if (!session) {
      setStage('idle');
      scheduleReconnect();
      return;
    }

    // A session file whose `pipe` field fails the \\.\pipe\ prefix check is
    // as untrustworthy as "no session" (either a bug in the writer or a
    // tampered file) -- never let it throw out of connectOnce, which would
    // crash the whole long-running adapter process on some LATER reconnect
    // attempt, not just the first call. Same fail-closed-without-throwing
    // posture as auth.mjs's macEquals/serverVerifyAuth.
    let d;
    try {
      assertPipePath(session.pipe);
      currentSecret = session.secret;
      d = connect(session.pipe);
    } catch {
      currentSecret = null;
      setStage('idle');
      scheduleReconnect();
      return;
    }
    duplex = d;
    setStage('awaiting-hello');

    let nonceC = null;
    let helloNonceS = null;

    function onFrame(frame) {
      if (stage === 'awaiting-hello') {
        if (frame?.t !== 'hello') {
          d.destroy();
          return;
        }
        helloNonceS = frame.nonceS;
        const auth = clientCreateAuth(currentSecret, frame);
        nonceC = auth.nonceC;
        setStage('awaiting-auth-ok');
        d.write(serializeFrame(auth));
        return;
      }
      if (stage === 'awaiting-auth-ok') {
        if (frame?.t !== 'auth-ok' || !clientVerifyAuthOk(currentSecret, nonceC, helloNonceS, frame)) {
          // Impostor server (or a malformed reply): disconnect BEFORE ever
          // sending a tool/cancel frame (O-3).
          d.destroy();
          return;
        }
        setStage('authenticated');
        return;
      }
      // authenticated: only `result` frames are valid inbound here.
      if (frame?.t === 'result') onResultFrame(frame);
    }

    const parser = createFrameParser({
      maxFrameBytes,
      onFrame,
      onError: () => d.destroy(),
    });

    d.on('data', (chunk) => parser.push(chunk.toString('utf8')));
    d.on('close', () => teardown());
    d.on('error', () => {});
  }

  function send(frame) {
    if (stage !== 'authenticated' || !duplex) return false;
    duplex.write(serializeFrame(frame));
    return true;
  }

  return {
    /** Starts the persistent-connection loop. Idempotent while running. */
    start() {
      if (!stopped) return;
      stopped = false;
      connectOnce();
    },
    /** Stops for good: no further reconnects, current connection (if any) is
     * torn down. */
    stop() {
      stopped = true;
      clearReconnectTimer();
      if (duplex) duplex.destroy();
      duplex = null;
      currentSecret = null;
      setStage('idle');
    },
    /** Sends a `{t:'tool', ...}` frame. Returns false (never throws, never
     * queues -- §3 M2) if not currently authenticated; the caller is
     * responsible for surfacing that as "app not running" to its own
     * caller. */
    sendTool(frame) {
      return send(frame);
    },
    /** Sends a `{t:'cancel', ...}` frame. Same not-connected contract as
     * sendTool. */
    sendCancel(frame) {
      return send(frame);
    },
    getState() {
      return stage;
    },
  };
}
