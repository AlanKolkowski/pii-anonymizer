// Gate queue — pure state machine for the human-approval workflow around
// bridge tool calls (MOST-IMPL-PLAN.md §3 M3, MCP-BRIDGE-DESIGN.md
// §6.1/§6.4/§6.5). Zero Electron: no BrowserWindow, no IPC. This module
// decides WHETHER and WHEN an already-computed payload (produced upstream
// by the renderer via listings.js builders) is released; actually rendering
// a gate window is electron/bridge/gate.mjs's job (BUILD phase, needs
// Electron) — it calls submit()/decide()/cancel()/pauseAll() and implements
// onOpen/onClose by creating/closing a real BrowserWindow. The callback
// design is specifically what makes the full decision workflow (FIFO,
// one-window-at-a-time, silence-after-rejection, timeout, request dedup,
// client cancel, pause) testable in full today, without any window.
//
// Every tool call — including list_* (MCP-BRIDGE-DESIGN.md §6.1: "żadne
// narzędzie" is exempt from the gate, per requirement W2) — is expected to
// go through exactly this workflow before its payload is allowed to reach
// the wire.

import { createHash } from 'node:crypto';

const DEFAULT_MAX_PENDING = 5; // §6.5
const DEFAULT_TIMEOUT_MS = 180_000; // decyzja 5 (supersedes the design doc's 120s)
const DEFAULT_SILENCE_WINDOW_MS = 60_000; // §6.5 "cisza po odmowie"

// Canonical fingerprint = hash(name + canonical args). Key order in `args`
// must not matter for dedup/silence purposes, so object keys are sorted
// recursively before stringifying.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

function defaultHashRequest(name, args) {
  return createHash('sha256').update(JSON.stringify([name, canonicalize(args)])).digest('hex');
}

// What onOpen/onClose (and getStatus, indirectly) are allowed to see:
// reqId/name/args/client/payload — no internal bookkeeping (timer, waiters,
// fingerprint) leaks to the caller.
function publicView(entry) {
  return { reqId: entry.reqId, name: entry.name, args: entry.args, client: entry.client, payload: entry.payload };
}

/**
 * @param {object} [options]
 * @param {number} [options.maxPending] - total requests trackable at once
 *   (currently open + still queued), §6.5.
 * @param {number} [options.timeoutMs] - decision timeout, decyzja 5 (a
 *   constructor argument on purpose — P-7 — never an environment variable).
 * @param {number} [options.silenceWindowMs] - §6.5 "cisza po odmowie" window.
 * @param {() => number} [options.now]
 * @param {typeof setTimeout} [options.setTimeoutFn]
 * @param {typeof clearTimeout} [options.clearTimeoutFn]
 * @param {(name: string, args: object) => string} [options.hashRequest]
 * @param {(entry: object) => void} [options.onOpen] - a request became the
 *   one to decide; the caller should open a gate window for it.
 * @param {(entry: object, info: {outcome: string}) => void} [options.onClose]
 *   - the currently-open request is done; the caller should close its window.
 *   Only ever called for an entry onOpen was previously called for.
 */
export function createGateQueue(options = {}) {
  const {
    maxPending = DEFAULT_MAX_PENDING,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    silenceWindowMs = DEFAULT_SILENCE_WINDOW_MS,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    hashRequest = defaultHashRequest,
    onOpen = () => {},
    onClose = () => {},
  } = options;

  const queue = []; // FIFO of not-yet-open entries
  const pendingByFingerprint = new Map(); // fingerprint -> entry (queued OR current)
  const silenceUntil = new Map(); // fingerprint -> timestamp until which it auto-denies

  // getStatus intentionally exposes ONLY these primitives — never an entry,
  // never a payload (MCP-BRIDGE-DESIGN.md §3.4: pii:bridge:status "Nigdy nie
  // niesie: treści payloadów"). See the canary test in gate-queue.test.js.
  let current = null;
  const counters = { approved: 0, rejected: 0, autoDenied: 0, timedOut: 0, cancelled: 0 };

  function settleAllWaiters(entry, outcome, extra) {
    for (const waiter of entry.waiters) waiter.resolve({ outcome, reqId: waiter.reqId, ...extra });
  }

  // Tears down `current` (timer, bookkeeping), fires onClose, and promotes
  // the next queued entry — the shared tail of every path that ends a
  // currently-open decision, regardless of how it ended.
  function closeCurrent(outcome, extra = {}) {
    const finished = current;
    if (finished.timer) clearTimeoutFn(finished.timer);
    pendingByFingerprint.delete(finished.fingerprint);
    current = null;
    onClose(publicView(finished), { outcome, ...extra });
    openNext();
    return finished;
  }

  function openNext() {
    if (current) return;
    const next = queue.shift();
    if (!next) return;
    current = next;
    current.timer = setTimeoutFn(() => finishCurrent('timeout'), timeoutMs);
    onOpen(publicView(current));
  }

  // approved / rejected / timeout: every waiter attached to the current
  // entry gets the SAME outcome (that is the point of request dedup — one
  // human decision, N callers). A rejection arms the silence window; a
  // timeout deliberately does not (§6.5 only ties silence to an explicit
  // human "Odrzuć", not to the absence of a decision).
  function finishCurrent(outcome, extra = {}) {
    if (!current) return;
    if (outcome === 'approved') counters.approved += 1;
    else if (outcome === 'rejected') counters.rejected += 1;
    else if (outcome === 'timeout') counters.timedOut += 1;

    if (outcome === 'rejected') silenceUntil.set(current.fingerprint, now() + silenceWindowMs);

    const finished = current;
    settleAllWaiters(finished, outcome, extra);
    closeCurrent(outcome, extra);
  }

  function submit({ reqId, name, args, client, payload }) {
    return new Promise((resolve) => {
      const fingerprint = hashRequest(name, args);

      const silencedUntil = silenceUntil.get(fingerprint);
      if (silencedUntil !== undefined && now() < silencedUntil) {
        counters.autoDenied += 1;
        resolve({ outcome: 'auto-denied', reqId });
        return;
      }

      const existing = pendingByFingerprint.get(fingerprint);
      if (existing) {
        // Duplicate of a request already queued or currently being decided:
        // attach to that SAME decision rather than opening a second window
        // (§6.5 "duplikat żądania wiszącego = podpięcie pod tę samą decyzję").
        existing.waiters.push({ reqId, resolve });
        return;
      }

      const totalTracked = queue.length + (current ? 1 : 0);
      if (totalTracked >= maxPending) {
        resolve({ outcome: 'queue-full', reqId });
        return;
      }

      const entry = { reqId, name, args, client, payload, fingerprint, waiters: [{ reqId, resolve }], timer: null };
      pendingByFingerprint.set(fingerprint, entry);
      queue.push(entry);
      openNext();
    });
  }

  // Addressed by reqId (R-5/R-6: the decision channel is valid only for the
  // currently-pending reqId) — a decision for any other reqId (stale,
  // forged, or simply late after the window already moved on) is silently
  // ignored rather than acted on.
  function decide(reqId, approved, meta = {}) {
    if (!current || current.reqId !== reqId) return false;
    finishCurrent(approved ? 'approved' : 'rejected', meta);
    return true;
  }

  // Client-initiated cancellation (MCP `notifications/cancelled`) of ONE
  // waiter, identified by its own reqId — wherever it currently is (queued
  // or open). Removing the last waiter of a still-queued entry simply drops
  // it (no window was ever opened, nothing to close); removing the last
  // waiter of the OPEN entry closes its window with an annotation
  // (MCP-BRIDGE-DESIGN.md §6.4). Other waiters sharing the same entry are
  // unaffected — the decision they're waiting on still lands normally.
  function cancel(reqId) {
    if (current) {
      const idx = current.waiters.findIndex((w) => w.reqId === reqId);
      if (idx !== -1) {
        const [waiter] = current.waiters.splice(idx, 1);
        counters.cancelled += 1;
        waiter.resolve({ outcome: 'cancelled', reqId });
        if (current.waiters.length === 0) closeCurrent('cancelled');
        return true;
      }
    }
    for (const entry of queue) {
      const idx = entry.waiters.findIndex((w) => w.reqId === reqId);
      if (idx === -1) continue;
      const [waiter] = entry.waiters.splice(idx, 1);
      counters.cancelled += 1;
      waiter.resolve({ outcome: 'cancelled', reqId });
      if (entry.waiters.length === 0) {
        queue.splice(queue.indexOf(entry), 1);
        pendingByFingerprint.delete(entry.fingerprint);
      }
      return true;
    }
    return false;
  }

  // Bridge paused or app exiting: auto-reject EVERYTHING immediately
  // (MCP-BRIDGE-DESIGN.md §5.5/§9.2). Deliberately does not arm the silence
  // window for any fingerprint — this is not a targeted human "Odrzuć" on a
  // specific request, so an identical request afterwards (e.g. once the
  // bridge is re-enabled) must open a fresh gate, not get auto-denied.
  function pauseAll(reason = 'bridge-paused') {
    if (current) {
      const finished = current;
      if (finished.timer) clearTimeoutFn(finished.timer);
      current = null;
      pendingByFingerprint.delete(finished.fingerprint);
      counters.rejected += 1;
      settleAllWaiters(finished, 'rejected', { reason });
      onClose(publicView(finished), { outcome: 'rejected', reason });
    }
    // Invariant elsewhere in this module (current === null => queue is
    // empty, maintained by openNext() running after every mutation) means
    // this loop is normally a no-op by the time we get here; kept anyway so
    // pauseAll stays exhaustive ("auto-reject everything") even if that
    // invariant is ever weakened by a future change.
    for (const entry of queue.splice(0, queue.length)) {
      pendingByFingerprint.delete(entry.fingerprint);
      counters.rejected += 1;
      settleAllWaiters(entry, 'rejected', { reason });
    }
  }

  // Metadata/counters ONLY — no entry, no payload, ever (mirrors the real
  // pii:bridge:status contract, which never carries payload content).
  function getStatus() {
    return {
      state: current ? 'busy' : 'idle',
      pendingCount: queue.length + (current ? 1 : 0),
      ...counters,
    };
  }

  return { submit, decide, cancel, pauseAll, getStatus };
}
