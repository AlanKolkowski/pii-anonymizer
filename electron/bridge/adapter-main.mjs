// Adapter-mode entry logic (MOST-IMPL-PLAN.md §3 M6, MCP-BRIDGE-DESIGN.md
// §7.1/§7.3). Pure, injectable building blocks for the real adapter entry
// point (electron/main-bridge.mjs, a BUILD-phase file per §3 M7) to compose.
// Deliberately imports NOTHING (not `electron`, not `node:net`, not
// electron/main.mjs, not even this bridge's own pipe-client.mjs/mcp-stdio.mjs) --
// every function here is provable in bare Node with fully injected
// collaborators. Wiring this to the real `electron` app object
// (disableHardwareAcceleration, --disable-gpu), to real process.argv/stdin/
// stdout/SIGTERM, and to pipe-client.mjs + mcp-stdio.mjs for a fully running
// adapter process is explicitly deferred to that BUILD-phase change (see the
// handoff report for this turn) -- the last of those needs a product
// decision this module does not invent here (how MCP `initialize`'s
// declared clientInfo becomes the `client` field of a `tool` pipe frame,
// MOST-IMPL-PLAN.md §3 M2's frame table).
//
// The ordering trap this module exists to make provable without booting
// Electron (MOST-IMPL-PLAN.md §10 P-1, mirrored in MCP-BRIDGE-DESIGN.md
// §5.4/§7.1 -- "rozgałęzienie argv przed single-instance"): electron/main.mjs
// runs `app.enableSandbox()` and `app.requestSingleInstanceLock()` as
// MODULE-TOP-LEVEL side effects, at import time, not inside a function
// (see electron/main.mjs lines ~96-103). So the ONLY safe way for
// main-bridge.mjs to avoid also running the GUI bootstrap when launched with
// `--bridge-adapter` is to check isBridgeAdapterMode(process.argv) BEFORE
// any static or dynamic `import('./main.mjs')` -- an import placed after the
// check, guarded by an `if`, still runs main.mjs's top-level side effects
// the instant it is reached. This module (a) never imports electron/main.mjs
// itself, and (b) never calls any GUI-bootstrap API by name -- both are
// asserted statically in adapter-main.test.js, mirroring net-invariants.test.js's
// own style of reading source text rather than trusting a comment.

export const BRIDGE_ADAPTER_FLAG = '--bridge-adapter';

/**
 * Pure argv check. Must be the FIRST thing main-bridge.mjs evaluates -- see
 * this module's header for why. Exact array-membership match (not a
 * substring/prefix test on the joined argv), so a look-alike flag such as
 * `--bridge-adapter-extra` never accidentally satisfies it.
 */
export function isBridgeAdapterMode(argv) {
  return Array.isArray(argv) && argv.includes(BRIDGE_ADAPTER_FLAG);
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

/**
 * P-4 (MOST-IMPL-PLAN.md §10): in adapter mode, stdout IS the MCP JSON-RPC
 * transport -- any stray console.log (including one from a dependency)
 * corrupts framing. Redirects every console.* method to the given stderr
 * writer instead of leaving it pointed at stdout. Returns a `restore()`
 * function so callers (and tests) can put the exact original methods back
 * deterministically, rather than leaking a patched global console.
 *
 * @param {object} [options]
 * @param {Console} [options.consoleObj] - injected so tests never patch the
 *   real global console.
 * @param {(text: string) => void} [options.stderrWrite] - injected sink;
 *   production wiring (main-bridge.mjs, BUILD phase) passes
 *   `(s) => process.stderr.write(s)`.
 */
export function installStderrOnlyConsole({ consoleObj, stderrWrite }) {
  if (!consoleObj) throw new Error('installStderrOnlyConsole requires consoleObj');
  if (typeof stderrWrite !== 'function') throw new Error('installStderrOnlyConsole requires stderrWrite');

  const originals = {};
  for (const method of CONSOLE_METHODS) {
    originals[method] = consoleObj[method];
    consoleObj[method] = (...args) => {
      stderrWrite(`${args.map(String).join(' ')}\n`);
    };
  }
  return function restore() {
    for (const method of CONSOLE_METHODS) consoleObj[method] = originals[method];
  };
}

/**
 * "koniec procesu przy zamknięciu stdin (klient sprząta – standard stdio
 * MCP) i przy SIGTERM" (MOST-IMPL-PLAN.md §3 M6): the MCP client owns the
 * adapter's lifecycle over stdio (it spawned the process and reads its
 * stdout); once the client closes stdin, or the OS asks the process to
 * terminate, the adapter must exit rather than linger as an orphan.
 * `onExit` fires AT MOST ONCE no matter how many of the two triggers land
 * (e.g. stdin ending right as a SIGTERM arrives must not double-run
 * shutdown logic). Fully injected -- no real `process`/`process.stdin`
 * touched here -- so this is provable without spawning anything; wiring
 * `stdin: process.stdin` and `signalSource: process` is main-bridge.mjs's
 * job (BUILD phase).
 *
 * @param {object} options
 * @param {{on: Function, off?: Function}} options.stdin
 * @param {(reason: 'stdin-end'|'signal') => void} options.onExit
 * @param {{on: Function, off?: Function}|null} [options.signalSource]
 * @param {string} [options.signal]
 */
export function registerAdapterLifecycle({ stdin, onExit, signalSource = null, signal = 'SIGTERM' }) {
  if (!stdin || typeof stdin.on !== 'function') throw new Error('registerAdapterLifecycle requires a stdin-like object');
  if (typeof onExit !== 'function') throw new Error('registerAdapterLifecycle requires onExit');

  let exited = false;
  function fireOnce(reason) {
    if (exited) return;
    exited = true;
    onExit(reason);
  }

  const onStdinEnd = () => fireOnce('stdin-end');
  stdin.on('end', onStdinEnd);

  let onSignal = null;
  if (signalSource) {
    onSignal = () => fireOnce('signal');
    signalSource.on(signal, onSignal);
  }

  return function dispose() {
    stdin.off?.('end', onStdinEnd);
    if (signalSource && onSignal) signalSource.off?.(signal, onSignal);
  };
}
