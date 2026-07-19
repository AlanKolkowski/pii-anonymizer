import { createMcpStdioServer, SUPPORTED_PROTOCOL_VERSION } from './mcp-stdio.mjs';
import { serializeFrame } from './framing.mjs';
import { ERRORS } from './errors.mjs';
import { TOOL_CATALOG } from '../../src/mcp/tool-catalog.js';

// MOST-IMPL-PLAN.md §3 M6 / §7.2 (O-11): a minimal MCP server over an
// abstract line-based transport, with zero @modelcontextprotocol/sdk
// dependency. `callTool` is the seam to the rest of the bridge — in the
// finished product it sends a `tool` frame over the `\\.\pipe\` transport
// and resolves with the `result` frame's content; that transport
// (pipe-client.mjs) is a BUILD-phase task (see the handoff report). Here it
// is fully injectable, so every JSON-RPC behaviour below (routing,
// validation, progress keep-alive, cancellation, stdout purity) is proven
// against a fake transport standing in for the real pipe.

function makeHarness(overrides = {}) {
  const written = [];
  const server = createMcpStdioServer({
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'stub-result' }], isError: false })),
    write: (line) => written.push(line),
    ...overrides,
  });
  return { server, written, parsedWritten: () => written.map((l) => JSON.parse(l)) };
}

function push(server, message) {
  server.pushInput(serializeFrame(message));
}

describe('initialize / ping / tools/list — golden transcripts', () => {
  it('initialize responds with the supported protocol version and serverInfo', () => {
    const { server, parsedWritten } = makeHarness();
    push(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-01-01' } });
    expect(parsedWritten()).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: expect.any(String), version: expect.any(String) },
        },
      },
    ]);
  });

  it('ping responds with an empty result echoing the request id', () => {
    const { server, parsedWritten } = makeHarness();
    push(server, { jsonrpc: '2.0', id: 'p1', method: 'ping' });
    expect(parsedWritten()).toEqual([{ jsonrpc: '2.0', id: 'p1', result: {} }]);
  });

  it('tools/list returns exactly the five catalog tools, each with a bridgeNote-augmented description', () => {
    const { server, parsedWritten } = makeHarness();
    push(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const [msg] = parsedWritten();
    expect(msg.result.tools.map((t) => t.name)).toEqual(TOOL_CATALOG.map((t) => t.name));
    for (const [i, tool] of msg.result.tools.entries()) {
      expect(tool.description).toContain(TOOL_CATALOG[i].description);
      expect(tool.description).toContain(TOOL_CATALOG[i].bridgeNote);
      expect(tool.inputSchema).toEqual(TOOL_CATALOG[i].inputSchema);
    }
  });
});

describe('tools/call — happy path', () => {
  it('forwards a valid call to callTool and returns its result verbatim', async () => {
    const callTool = vi.fn(async ({ reqId, name, args }) => {
      expect(typeof reqId).toBe('string');
      expect(name).toBe('read_source');
      expect(args).toEqual({ id: 's1' });
      return { content: [{ type: 'text', text: '[PERSON_NAME_1] mieszka w Toruniu.' }], isError: false };
    });
    const { server, parsedWritten } = makeHarness({ callTool });

    push(server, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_source', arguments: { id: 's1' } } });
    await vi.waitFor(() => expect(parsedWritten()).toHaveLength(1));

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(parsedWritten()).toEqual([
      { jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: '[PERSON_NAME_1] mieszka w Toruniu.' }], isError: false } },
    ]);
  });
});

describe('tools/call — validation before ever reaching callTool', () => {
  it('rejects an unknown tool name without invoking callTool', async () => {
    const callTool = vi.fn();
    const { server, parsedWritten } = makeHarness({ callTool });
    push(server, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'rm_rf', arguments: {} } });
    await vi.waitFor(() => expect(parsedWritten()).toHaveLength(1));
    expect(callTool).not.toHaveBeenCalled();
    expect(parsedWritten()).toEqual([
      { jsonrpc: '2.0', id: 6, result: { content: [{ type: 'text', text: ERRORS.UNKNOWN_TOOL }], isError: true } },
    ]);
  });

  it('rejects invalid arguments (missing required id) without invoking callTool', async () => {
    const callTool = vi.fn();
    const { server, parsedWritten } = makeHarness({ callTool });
    push(server, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'read_source', arguments: {} } });
    await vi.waitFor(() => expect(parsedWritten()).toHaveLength(1));
    expect(callTool).not.toHaveBeenCalled();
    expect(parsedWritten()[0].result).toEqual({ content: [{ type: 'text', text: ERRORS.INVALID_ARGS }], isError: true });
  });

  it('treats a callTool rejection as a closed-list internal error, never a raw stack trace', async () => {
    const callTool = vi.fn(async () => { throw new Error('leaky internal detail: /Users/alan/secret-path'); });
    const { server, parsedWritten } = makeHarness({ callTool });
    push(server, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'list_sources', arguments: {} } });
    await vi.waitFor(() => expect(parsedWritten()).toHaveLength(1));
    const [msg] = parsedWritten();
    expect(msg.result).toEqual({ content: [{ type: 'text', text: ERRORS.INTERNAL_TRANSPORT_ERROR }], isError: true });
    expect(JSON.stringify(msg)).not.toContain('secret-path');
  });
});

describe('progress keep-alive (R-7: every 10s while a gate decision is pending)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends notifications/progress every 10s only when the client supplied a progressToken, and stops once decided', async () => {
    let resolveCallTool;
    const callTool = vi.fn(() => new Promise((resolve) => { resolveCallTool = resolve; }));
    const { server, parsedWritten } = makeHarness({ callTool });

    push(server, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'list_sources', arguments: {}, _meta: { progressToken: 'tok-1' } },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const progressNotifications = parsedWritten().filter((m) => m.method === 'notifications/progress');
    expect(progressNotifications).toHaveLength(2);
    expect(progressNotifications[0]).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', message: expect.any(String) },
    });

    resolveCallTool({ content: [{ type: 'text', text: 'ok' }], isError: false });
    await vi.waitFor(() => expect(parsedWritten().some((m) => m.id === 9)).toBe(true));

    const countAfterResolution = parsedWritten().filter((m) => m.method === 'notifications/progress').length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(parsedWritten().filter((m) => m.method === 'notifications/progress')).toHaveLength(countAfterResolution);
  });

  it('sends no progress notifications when the client did not supply a progressToken', async () => {
    let resolveCallTool;
    const callTool = vi.fn(() => new Promise((resolve) => { resolveCallTool = resolve; }));
    const { server, parsedWritten } = makeHarness({ callTool });

    push(server, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_sources', arguments: {} } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(parsedWritten().filter((m) => m.method === 'notifications/progress')).toEqual([]);
    resolveCallTool({ content: [{ type: 'text', text: 'ok' }], isError: false });
  });
});

describe('notifications/cancelled', () => {
  it('translates a cancel notification (by JSON-RPC request id) into cancelTool(reqId) for the matching in-flight call', async () => {
    let capturedReqId;
    const callTool = vi.fn(({ reqId }) => {
      capturedReqId = reqId;
      return new Promise(() => {}); // never resolves in this test
    });
    const cancelTool = vi.fn();
    const { server } = makeHarness({ callTool, cancelTool });

    push(server, { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'list_sources', arguments: {} } });
    await vi.waitFor(() => expect(capturedReqId).toBeDefined());

    push(server, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 11 } });
    expect(cancelTool).toHaveBeenCalledWith(capturedReqId);
  });

  it('is a silent no-op for an unknown/already-finished request id', () => {
    const cancelTool = vi.fn();
    const { server } = makeHarness({ cancelTool });
    expect(() => push(server, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'never-existed' } })).not.toThrow();
    expect(cancelTool).not.toHaveBeenCalled();
  });
});

describe('unknown methods and malformed input', () => {
  it('responds -32601 Method not found for an unrecognized method carrying an id', () => {
    const { server, parsedWritten } = makeHarness();
    push(server, { jsonrpc: '2.0', id: 12, method: 'resources/list' });
    expect(parsedWritten()).toEqual([{ jsonrpc: '2.0', id: 12, error: { code: -32601, message: expect.any(String) } }]);
  });

  it('silently drops an unrecognized method with no id (a notification has no response channel)', () => {
    const { server, parsedWritten } = makeHarness();
    push(server, { jsonrpc: '2.0', method: 'notifications/something-unknown' });
    expect(parsedWritten()).toEqual([]);
  });

  it('silently drops a line that is not JSON at all, without throwing and without echoing it back', () => {
    const { server, parsedWritten } = makeHarness();
    expect(() => server.pushInput('this is not json\n')).not.toThrow();
    expect(parsedWritten()).toEqual([]);
  });

  it('silently drops a JSON value that is not a JSON-RPC 2.0 message', () => {
    const { server, parsedWritten } = makeHarness();
    push(server, { foo: 'bar' });
    push(server, { jsonrpc: '1.0', id: 1, method: 'ping' });
    expect(parsedWritten()).toEqual([]);
  });
});

describe('stdout purity (mirrors C-BR-17: every emitted line is clean JSON-RPC)', () => {
  it('every line written across a realistic multi-message session parses as a well-formed JSON-RPC 2.0 message', async () => {
    const { server, written } = makeHarness();
    push(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    push(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    push(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_outcomes', arguments: {} } });
    await vi.waitFor(() => expect(written.length).toBeGreaterThanOrEqual(3));
    push(server, { jsonrpc: '2.0', id: 4, method: 'not-a-real-method' });

    for (const line of written) {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.match(/\n/g)).toHaveLength(1); // exactly the terminator -- no stray newline mid-line
      const parsed = JSON.parse(line);
      expect(parsed.jsonrpc).toBe('2.0');
      expect('id' in parsed || parsed.method).toBeTruthy();
    }
  });
});
