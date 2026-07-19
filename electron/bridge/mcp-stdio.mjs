// Minimal MCP server over an abstract line-based transport (MOST-IMPL-
// PLAN.md §3 M6, §7.2, O-11 — zero-dependency: no
// @modelcontextprotocol/sdk, consistent with the packaged app shipping no
// node_modules at all). Handles exactly the subset MCP-BRIDGE-DESIGN.md §7.2
// specifies: initialize, ping, tools/list, tools/call,
// notifications/cancelled, plus notifications/progress keep-alive while a
// gate decision is pending (R-7). Capabilities: tools only.
//
// `callTool({ reqId, name, args })` is the seam to the rest of the bridge.
// In the finished product this sends a `tool` frame over the `\\.\pipe\`
// transport and resolves with the `result` frame's content once a human
// decides in the gate window — that transport (pipe-client.mjs) is a
// BUILD-phase task (see the handoff report for this change: the real
// end-to-end pipe was explicitly out of scope for this turn). Here it is
// fully injectable, so every JSON-RPC behaviour below — routing, argument
// validation BEFORE anything is forwarded, the progress keep-alive timer,
// cancellation, and stdout purity — is tested against a fake transport
// standing in for the pipe.
//
// `write(line)` receives one already-serialized NDJSON line per outbound
// message. In production (electron/bridge/adapter-main.mjs, a BUILD-phase
// file) this is process.stdout — the ONE thing allowed to touch stdout in
// adapter mode, since stdout IS the protocol (P-4: any stray console.log,
// including from a dependency, corrupts framing). Every message this module
// ever writes goes through serializeFrame, so stdout purity reduces to
// "handleMessage never calls anything except send()" — checked here via
// the harness's `write`, and checked in production by redirecting
// console.* to stderr before this module is ever reachable (adapter-main.mjs).
import { randomUUID } from 'node:crypto';
import { getToolDefinition, validateToolArgs, TOOL_CATALOG } from '../../src/mcp/tool-catalog.js';
import { ERRORS, toolErrorResult } from './errors.mjs';
import { serializeFrame, createFrameParser } from './framing.mjs';

// Latest STABLE MCP spec revision as of this writing (2026-07); see the
// handoff report for the source. A 2026-07-28 release candidate exists that
// removes the initialize handshake for Streamable HTTP sessions, but that
// change is (a) not final and (b) framed around HTTP transport statefulness,
// not stdio — this adapter is stdio-only, where initialize remains the
// natural, spec-current handshake. Revisit this constant if/when that RC
// finalizes and stdio guidance changes.
export const SUPPORTED_PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'lokalny-anonimizator-ai-bridge';
const SERVER_VERSION = '0.1.0';
const DEFAULT_PROGRESS_INTERVAL_MS = 10_000; // R-7: margin x6 over the shortest known client tool timeout

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// "description + bridgeNote" (R-2 / §3 M6): the note is folded into the
// wire-level description text rather than shipped as a made-up extra JSON
// field, so it survives through any spec-compliant client's tool-list
// rendering instead of depending on an unknown field being preserved.
function toolsListPayload() {
  return {
    tools: TOOL_CATALOG.map((def) => ({
      name: def.name,
      description: `${def.description} ${def.bridgeNote}.`,
      inputSchema: def.inputSchema,
    })),
  };
}

export function createMcpStdioServer({
  callTool,
  cancelTool = () => {},
  write,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
  generateReqId = randomUUID,
} = {}) {
  if (typeof callTool !== 'function') throw new Error('createMcpStdioServer requires a callTool function');
  if (typeof write !== 'function') throw new Error('createMcpStdioServer requires a write function');

  // JSON-RPC request id (any JSON value per spec: number or string) ->
  // internal bridge reqId — lets a later notifications/cancelled (which
  // references the ORIGINAL request's JSON-RPC id, per MCP spec) be
  // translated into cancelTool(reqId) for the transport layer.
  const reqIdByRpcId = new Map();

  function send(message) {
    write(serializeFrame(message));
  }

  function handleInitialize(msg) {
    send(jsonRpcResult(msg.id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    }));
  }

  function handlePing(msg) {
    send(jsonRpcResult(msg.id, {}));
  }

  function handleToolsList(msg) {
    send(jsonRpcResult(msg.id, toolsListPayload()));
  }

  async function handleToolsCall(msg) {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    const progressToken = msg.params?._meta?.progressToken;

    // Validated BEFORE anything is forwarded — a bad tool name or bad
    // arguments never reaches callTool (and, downstream in the finished
    // product, never reaches the pipe or the gate). This is the adapter-side
    // half of C-BR-10; the Electron main process re-validates the same
    // schemas again as defense in depth (a BUILD-phase wiring concern, not
    // this module's).
    if (!getToolDefinition(name)) {
      send(jsonRpcResult(msg.id, toolErrorResult(ERRORS.UNKNOWN_TOOL)));
      return;
    }
    const validation = validateToolArgs(name, args);
    if (!validation.ok) {
      send(jsonRpcResult(msg.id, toolErrorResult(ERRORS.INVALID_ARGS)));
      return;
    }

    const reqId = generateReqId();
    reqIdByRpcId.set(msg.id, reqId);

    // R-7: keep-alive notifications while a human decides, only if the
    // client asked for progress reporting at all (MCP `_meta.progressToken`).
    // Cleared unconditionally once the call settles, one way or another.
    let progressTimer = null;
    if (progressToken !== undefined) {
      progressTimer = setIntervalFn(() => {
        send({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: { progressToken, message: 'Oczekiwanie na decyzję użytkownika w aplikacji…' },
        });
      }, progressIntervalMs);
    }

    try {
      const result = await callTool({ reqId, name, args });
      send(jsonRpcResult(msg.id, result));
    } catch {
      // The transport threw instead of resolving with an isError result —
      // an unexpected failure (a correct transport always resolves; see
      // gate-queue.mjs, whose submit() never rejects). Never surface the
      // raw error/stack (it could carry a local path or other operational
      // detail): fall back to the one closed-list message for this case.
      send(jsonRpcResult(msg.id, toolErrorResult(ERRORS.INTERNAL_TRANSPORT_ERROR)));
    } finally {
      if (progressTimer) clearIntervalFn(progressTimer);
      reqIdByRpcId.delete(msg.id);
    }
  }

  function handleCancelled(msg) {
    const targetRpcId = msg.params?.requestId;
    const reqId = reqIdByRpcId.get(targetRpcId);
    if (reqId !== undefined) cancelTool(reqId);
  }

  function handleMessage(msg) {
    if (msg === null || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      // Not a JSON-RPC 2.0 message at all -- there is no id to hang a
      // response off, and echoing arbitrary/attacker-controlled content
      // back would itself be a risk. Drop it silently.
      return;
    }
    switch (msg.method) {
      case 'initialize': return handleInitialize(msg);
      case 'ping': return handlePing(msg);
      case 'tools/list': return handleToolsList(msg);
      case 'tools/call': return handleToolsCall(msg);
      case 'notifications/cancelled': return handleCancelled(msg);
      default:
        // "nieznana metoda = błąd JSON-RPC -32601" (§3 M6) -- but only when
        // there is an id to answer; a notification (no id) for an unknown
        // method has no response channel either way.
        if (msg.id !== undefined) send(jsonRpcError(msg.id, -32601, 'Method not found'));
        return;
    }
  }

  const parser = createFrameParser({
    onFrame: handleMessage,
    // "ramka niebędąca JSON = błąd bez echa treści" (§3 M6): nothing is
    // written back for a line that fails to parse at all.
    onError: () => {},
  });

  return {
    /** Feed raw bytes/text from the transport (stdin in production). */
    pushInput: (chunk) => parser.push(chunk),
  };
}
