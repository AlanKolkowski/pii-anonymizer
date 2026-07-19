// Pipe-server LOGIC: connection lifecycle + auth handshake + tool/result/
// cancel frame exchange (MOST-IMPL-PLAN.md §3 M2), over an INJECTED
// duplex-like transport. This is the server side ("G" = GUI/main process in
// the M2 frame table) of the bridge's own application protocol -- NOT the
// MCP JSON-RPC layer (that's mcp-stdio.mjs, which lives in the adapter
// process and talks to the LLM client over stdio, not over this pipe).
//
// Deliberately NOT the `\\.\pipe\` binding: per this turn's scope, wiring an
// actual Windows named pipe (a thin `net.createServer().listen(pipeName)`
// wrapper that calls acceptConnection() for each incoming socket) is a
// follow-up BUILD-phase change -- see the handoff report for this turn. Zero
// networking-module imports here; electron/bridge/net-invariants.test.js
// stays green (it currently asserts ZERO occurrences of any of those modules
// anywhere under electron/, and this file adds none) until that follow-up
// change relaxes it to an allow-list of exactly this file + pipe-client.mjs,
// per that test's own inline note.
//
// "Duplex-like transport" = the minimal subset of a socket this module
// actually touches: write(chunk), on('data'|'close'|'error', cb), destroy().
// Tests pass an in-memory fake implementing exactly that surface; a real
// net.Socket satisfies it unchanged, which is what makes the eventual
// BUILD-phase wrapper thin rather than a rewrite.

import { serverCreateHello, serverVerifyAuth } from './auth.mjs';
import { serializeFrame, createFrameParser } from './framing.mjs';

export const PIPE_PATH_PREFIX = '\\\\.\\pipe\\';

// Hard construction-time assertion (MOST-IMPL-PLAN.md §3 M2: "ścieżka
// nasłuchu MUSI zaczynać się literalnie od \\.\pipe\ – inaczej wyjątek przed
// jakimkolwiek listen"). No real `listen()` happens in this module yet, but
// the assertion fires now, at construction, on the exact same string the
// future BUILD-phase wrapper will pass to the real bind call -- so the
// safety property holds today and continues to hold unchanged once that
// wrapper exists. Shared with pipe-client.mjs (same literal rule for the
// path it connects to).
export function assertPipePath(pipePath) {
  if (typeof pipePath !== 'string' || !pipePath.startsWith(PIPE_PATH_PREFIX)) {
    throw new Error(`refusing a non-pipe path (must start with ${PIPE_PATH_PREFIX}): ${JSON.stringify(pipePath)}`);
  }
  return pipePath;
}

const DEFAULT_MAX_CONNECTIONS = 4; // §3 M2: "maks. 4 uwierzytelnione połączenia"
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000;
const DEFAULT_THROTTLE_MS = 1000; // "throttle 1 s po nieudanym auth"
const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * @param {object} options
 * @param {string} options.pipeName - validated with assertPipePath; not used
 *   to bind anything in this module, only carried for parity with the
 *   eventual real listener and exposed via getStatus() for UI/config display.
 * @param {string} options.secret - shared HMAC secret from the session file.
 * @param {number} [options.maxConnections]
 * @param {number} [options.handshakeTimeoutMs]
 * @param {number} [options.throttleMs]
 * @param {number} [options.maxFrameBytes]
 * @param {() => number} [options.now]
 * @param {typeof setTimeout} [options.setTimeoutFn]
 * @param {typeof clearTimeout} [options.clearTimeoutFn]
 * @param {(frame: object, handle: object) => void} [options.onToolFrame] -
 *   an authenticated peer sent {t:'tool', reqId, name, args, client}.
 * @param {(frame: object, handle: object) => void} [options.onCancelFrame] -
 *   an authenticated peer sent {t:'cancel', reqId}.
 * @param {(handle: object, info: {authenticated: boolean}) => void} [options.onConnectionClosed]
 * @param {(count: number) => void} [options.onConnectionCountChange]
 */
export function createPipeServer({
  pipeName,
  secret,
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
  throttleMs = DEFAULT_THROTTLE_MS,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onToolFrame = () => {},
  onCancelFrame = () => {},
  onConnectionClosed = () => {},
  onConnectionCountChange = () => {},
}) {
  assertPipePath(pipeName);
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('createPipeServer requires a secret');
  }

  const connections = new Set(); // authenticated connections only
  let lastAuthFailureAt = -Infinity;
  let authFailureCount = 0;

  function isThrottled() {
    return now() - lastAuthFailureAt < throttleMs;
  }
  // A failed handshake -- wrong MAC, malformed auth frame, oversized/garbage
  // input pre-auth, or a handshake that never completes within the timeout --
  // all count as "nieudany auth" for throttling purposes: every one of them
  // is indistinguishable from an attacker probing without the secret.
  function recordAuthFailure() {
    lastAuthFailureAt = now();
    authFailureCount += 1;
  }

  /** Accepts one already-connected duplex (production: a fresh net.Socket
   * from the 'connection' event of a real \\.\pipe\ listener; tests: an
   * in-memory fake). Returns a connection handle, or null if the connection
   * was refused outright (throttled / over capacity) without ever starting
   * a handshake. */
  function acceptConnection(duplex) {
    if (isThrottled()) {
      duplex.destroy();
      return null;
    }
    if (connections.size >= maxConnections) {
      // "nadmiar: ramka błędu + rozłączenie"
      duplex.write(serializeFrame({ t: 'error', reason: 'too-many-connections' }));
      duplex.destroy();
      return null;
    }

    const hello = serverCreateHello();
    let authenticated = false;
    let destroyed = false;

    const handle = {
      /** Sends an already-built `{t:'result', reqId, result}` frame
       * (payload-envelope.mjs's buildResultFrame) back to this peer. A
       * no-op if the connection already closed -- the caller (eventually
       * gate-queue.mjs's decision resolution) never needs to check first. */
      sendResult(resultFrame) {
        if (!destroyed) duplex.write(serializeFrame(resultFrame));
      },
      close() {
        duplex.destroy();
      },
    };

    const handshakeTimer = setTimeoutFn(() => {
      if (!authenticated) {
        recordAuthFailure();
        duplex.destroy();
      }
    }, handshakeTimeoutMs);

    const parser = createFrameParser({
      maxFrameBytes,
      onFrame(frame) {
        if (!authenticated) {
          if (frame?.t !== 'auth') {
            recordAuthFailure();
            duplex.destroy();
            return;
          }
          const result = serverVerifyAuth(secret, hello.nonceS, frame);
          if (!result.ok) {
            recordAuthFailure();
            duplex.destroy();
            return;
          }
          clearTimeoutFn(handshakeTimer);
          authenticated = true;
          duplex.write(serializeFrame(result.authOk));
          connections.add(handle);
          onConnectionCountChange(connections.size);
          return;
        }
        // Post-auth: the M2 frame table defines exactly two inbound shapes
        // (A→G: tool, cancel). Anything else is silently ignored -- there is
        // no ad-hoc error path for a frame shape the protocol doesn't define
        // (mirrors mcp-stdio.mjs's own "unknown method, no id -> drop").
        if (frame?.t === 'tool') onToolFrame(frame, handle);
        else if (frame?.t === 'cancel') onCancelFrame(frame, handle);
      },
      onError() {
        // Malformed or oversized frame. Pre-auth this is itself a failed
        // handshake attempt (never produced a valid `auth` frame).
        if (!authenticated) recordAuthFailure();
        duplex.destroy();
      },
    });

    duplex.on('data', (chunk) => parser.push(chunk.toString('utf8')));
    duplex.on('close', () => {
      clearTimeoutFn(handshakeTimer);
      destroyed = true;
      const wasAuthenticated = authenticated;
      if (wasAuthenticated) {
        connections.delete(handle);
        onConnectionCountChange(connections.size);
      }
      onConnectionClosed(handle, { authenticated: wasAuthenticated });
    });
    duplex.on('error', () => {}); // 'close' still follows; nothing extra to do

    duplex.write(serializeFrame(hello));
    return handle;
  }

  // Metadata/counters ONLY -- never a payload, never a frame, mirroring
  // gate-queue.mjs's getStatus() contract (pii:bridge:status never carries
  // payload content).
  function getStatus() {
    return { pipeName, connectionCount: connections.size, maxConnections, authFailureCount };
  }

  function closeAll() {
    for (const handle of connections) handle.close();
  }

  return { acceptConnection, getStatus, closeAll };
}
