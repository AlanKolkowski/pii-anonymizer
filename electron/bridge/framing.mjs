// NDJSON framing shared by every line-based transport in the bridge: the
// adapter's stdio side (electron/bridge/mcp-stdio.mjs) today, and — per
// MOST-IMPL-PLAN.md §3 M2 — the `\\.\pipe\` transport later (pipe-server.mjs
// / pipe-client.mjs, a BUILD-phase task; see the handoff report for this
// change). One frame per line. `JSON.stringify` already guarantees no raw
// newline survives inside a serialized frame (P-5: "nie pisać własnego
// escapowania"), so serialization needs no custom escaping at all — the
// only nontrivial part is the streaming parser (partial lines across chunk
// boundaries, a hard size limit, tolerating one bad line without losing the
// rest of the stream).

const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024; // 4 MiB, MCP-BRIDGE-DESIGN.md §4.3

export function serializeFrame(frame) {
  return JSON.stringify(frame) + '\n';
}

/**
 * Streaming line-buffered NDJSON parser. Feed it chunks as they arrive
 * (socket data / stdin) via `push(chunk)`; it calls `onFrame(parsedObject)`
 * for each complete, valid line and `onError(err)` for anything that
 * doesn't parse as JSON or exceeds `maxFrameBytes` — never throws either
 * way, so a single malformed or oversized line cannot take the whole
 * transport down. A partial trailing line is held across calls.
 */
export function createFrameParser({ maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, onFrame, onError } = {}) {
  let buffer = '';

  function push(chunk) {
    buffer += chunk;

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length === 0) continue; // tolerate blank keep-alive lines

      if (Buffer.byteLength(line, 'utf8') > maxFrameBytes) {
        onError?.(new Error('frame exceeds maximum size'));
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        // "ramka niebędąca JSON = błąd bez echa treści" (§3 M6) — the
        // caller decides what to do (disconnect / JSON-RPC parse error);
        // this module never echoes the offending bytes back anywhere.
        onError?.(new Error('frame is not valid JSON'));
        continue;
      }
      onFrame?.(parsed);
    }

    // No newline seen yet in the buffered remainder — guard against an
    // ever-growing buffer if one never arrives at all (a bug or an
    // adversarial peer streaming bytes with no frame boundary is its own
    // denial-of-service otherwise).
    if (Buffer.byteLength(buffer, 'utf8') > maxFrameBytes) {
      onError?.(new Error('frame exceeds maximum size'));
      buffer = '';
    }
  }

  return { push };
}
