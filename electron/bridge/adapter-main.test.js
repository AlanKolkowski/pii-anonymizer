import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_ADAPTER_FLAG,
  installStderrOnlyConsole,
  isBridgeAdapterMode,
  registerAdapterLifecycle,
} from './adapter-main.mjs';

// MOST-IMPL-PLAN.md §3 M6: argv branching, the P-1 ordering-safety property
// (mirrored in MCP-BRIDGE-DESIGN.md §5.4/§7.1: "rozgałęzienie argv przed
// single-instance"), and stdout/stderr discipline -- as pure, injectable
// logic. Wiring this to the real Electron `app` object and to a fully
// running adapter (pipe-client.mjs + mcp-stdio.mjs) is a BUILD-phase task
// (see adapter-main.mjs's header) and is deliberately NOT exercised here.

describe('isBridgeAdapterMode', () => {
  it('is true when the flag is present anywhere in argv', () => {
    expect(isBridgeAdapterMode(['node', 'main-bridge.mjs', BRIDGE_ADAPTER_FLAG])).toBe(true);
    expect(isBridgeAdapterMode([BRIDGE_ADAPTER_FLAG])).toBe(true);
    expect(isBridgeAdapterMode(['a', BRIDGE_ADAPTER_FLAG, 'b'])).toBe(true);
  });

  it('is false when the flag is absent', () => {
    expect(isBridgeAdapterMode(['node', 'main-bridge.mjs'])).toBe(false);
    expect(isBridgeAdapterMode([])).toBe(false);
  });

  it('requires an exact match -- a look-alike flag never satisfies it', () => {
    expect(isBridgeAdapterMode(['--bridge-adapter-extra'])).toBe(false);
    expect(isBridgeAdapterMode(['--bridge-adapterX'])).toBe(false);
    expect(isBridgeAdapterMode(['--BRIDGE-ADAPTER'])).toBe(false);
    expect(isBridgeAdapterMode(['--bridge-adapter=1'])).toBe(false);
  });

  it('never throws on malformed input -- fails closed to "not adapter mode"', () => {
    expect(isBridgeAdapterMode(undefined)).toBe(false);
    expect(isBridgeAdapterMode(null)).toBe(false);
    expect(isBridgeAdapterMode('--bridge-adapter')).toBe(false); // a string, not an argv array
    expect(isBridgeAdapterMode({})).toBe(false);
  });
});

describe('P-1 ordering property: the argv check must gate any GUI-lock side effect', () => {
  it('demonstrates the safe branching pattern main-bridge.mjs must follow: a stand-in for requestSingleInstanceLock is never reached when --bridge-adapter is present', () => {
    const requestSingleInstanceLock = vi.fn(() => true);
    const importMainMjs = vi.fn();

    // Stand-in for main-bridge.mjs's own top-of-file branch (that file is
    // BUILD-phase and does not exist yet). What matters here is that
    // isBridgeAdapterMode is a pure, side-effect-free, synchronous check
    // suitable as the FIRST thing evaluated, before anything that would
    // trigger main.mjs's module-top-level requestSingleInstanceLock() call.
    function simulateMainBridgeEntry(argv) {
      if (isBridgeAdapterMode(argv)) return 'adapter';
      requestSingleInstanceLock();
      importMainMjs();
      return 'gui';
    }

    expect(simulateMainBridgeEntry(['node', 'x', BRIDGE_ADAPTER_FLAG])).toBe('adapter');
    expect(requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(importMainMjs).not.toHaveBeenCalled();

    expect(simulateMainBridgeEntry(['node', 'x'])).toBe('gui');
    expect(requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(importMainMjs).toHaveBeenCalledTimes(1);
  });
});

describe('installStderrOnlyConsole', () => {
  it('redirects every console method to the injected stderr writer instead of the original implementation', () => {
    const fakeConsole = { log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {} };
    const originalLog = fakeConsole.log;
    const stderrLines = [];

    installStderrOnlyConsole({ consoleObj: fakeConsole, stderrWrite: (s) => stderrLines.push(s) });

    expect(fakeConsole.log).not.toBe(originalLog);
    fakeConsole.log('CANARY', 42);
    fakeConsole.error('boom');
    expect(stderrLines).toEqual(['CANARY 42\n', 'boom\n']);
  });

  it('restore() puts back the exact original method references', () => {
    const originalLog = () => 'original';
    const fakeConsole = { log: originalLog, info() {}, warn() {}, error() {}, debug() {}, trace() {} };

    const restore = installStderrOnlyConsole({ consoleObj: fakeConsole, stderrWrite: () => {} });
    expect(fakeConsole.log).not.toBe(originalLog);
    restore();
    expect(fakeConsole.log).toBe(originalLog);
  });

  it('a canary logged in adapter mode never reaches the pre-install console implementation (proof stdout purity is achievable)', () => {
    const stdoutCalls = [];
    const fakeConsole = { log: (...a) => stdoutCalls.push(a), info() {}, warn() {}, error() {}, debug() {}, trace() {} };
    installStderrOnlyConsole({ consoleObj: fakeConsole, stderrWrite: () => {} });
    fakeConsole.log('a stray dependency log line that would otherwise corrupt JSON-RPC framing');
    expect(stdoutCalls).toEqual([]); // the original stdout-bound implementation was never invoked
  });

  it('requires both consoleObj and stderrWrite', () => {
    expect(() => installStderrOnlyConsole({ stderrWrite: () => {} })).toThrow();
    expect(() => installStderrOnlyConsole({ consoleObj: console })).toThrow();
  });
});

describe('registerAdapterLifecycle', () => {
  function makeFakeEmitter() {
    const listeners = {};
    return {
      on(event, cb) {
        (listeners[event] ??= []).push(cb);
      },
      off(event, cb) {
        listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb);
      },
      emit(event, ...args) {
        for (const cb of listeners[event] ?? []) cb(...args);
      },
    };
  }

  it('calls onExit("stdin-end") when stdin emits "end"', () => {
    const stdin = makeFakeEmitter();
    const onExit = vi.fn();
    registerAdapterLifecycle({ stdin, onExit });
    stdin.emit('end');
    expect(onExit).toHaveBeenCalledWith('stdin-end');
  });

  it('calls onExit("signal") when the signal source emits the configured signal', () => {
    const stdin = makeFakeEmitter();
    const proc = makeFakeEmitter();
    const onExit = vi.fn();
    registerAdapterLifecycle({ stdin, onExit, signalSource: proc, signal: 'SIGTERM' });
    proc.emit('SIGTERM');
    expect(onExit).toHaveBeenCalledWith('signal');
  });

  it('fires onExit at most once even if both stdin-end and the signal arrive', () => {
    const stdin = makeFakeEmitter();
    const proc = makeFakeEmitter();
    const onExit = vi.fn();
    registerAdapterLifecycle({ stdin, onExit, signalSource: proc });
    stdin.emit('end');
    proc.emit('SIGTERM');
    stdin.emit('end');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('dispose() unregisters both listeners', () => {
    const stdin = makeFakeEmitter();
    const proc = makeFakeEmitter();
    const onExit = vi.fn();
    const dispose = registerAdapterLifecycle({ stdin, onExit, signalSource: proc });
    dispose();
    stdin.emit('end');
    proc.emit('SIGTERM');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('requires stdin and onExit', () => {
    expect(() => registerAdapterLifecycle({ onExit: () => {} })).toThrow();
    expect(() => registerAdapterLifecycle({ stdin: makeFakeEmitter() })).toThrow();
  });
});

describe('source purity: adapter-main.mjs never touches GUI bootstrap (static, mirrors net-invariants.test.js style)', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./adapter-main.mjs', import.meta.url)), 'utf8');

  // The header comment deliberately DISCUSSES these identifiers in prose
  // (explaining what main.mjs does and why the ordering matters), so the
  // "never references" checks below run against the CODE only -- comments
  // stripped -- exactly like net-invariants.test.js targets real import
  // syntax rather than any substring anywhere in the file. Safe for this
  // specific, simple, comment-and-plain-string source (no `//`/`/*` inside
  // any of its string literals).
  const CODE_ONLY = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('has zero import statements at all -- no electron, no node:net, no sibling bridge module, no electron/main.mjs', () => {
    const importSpecifiers = [...SOURCE.matchAll(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(importSpecifiers).toEqual([]);
  });

  it.each([
    'requestSingleInstanceLock',
    'BrowserWindow',
    'registerAppScheme',
    'whenReady',
    'enableSandbox',
    'verifyModelIntegrity',
    'createMainWindow',
    "require('electron')",
    'from \'electron\'',
    'from "electron"',
  ])('never references %s in actual code (comments aside)', (needle) => {
    expect(CODE_ONLY).not.toContain(needle);
  });
});
