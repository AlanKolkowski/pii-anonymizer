// Single source of truth for the five MCP tool definitions (MOST-IMPL-PLAN.md
// R-2). Consumed by:
//   - src/main.js's WebMCP registrations (web build, variant A) — reads
//     name/description/inputSchema from here instead of carrying a second
//     literal copy, so the two transports are in parity BY CONSTRUCTION
//     rather than by a comparison test.
//   - the future desktop bridge adapter's `tools/list` (electron/bridge/
//     mcp-stdio.mjs) — per R-3 this file ships inside app.asar for variant B
//     (closed five-file list: anonymizer.js, tokens.js, substitution.js,
//     identifier-patterns.json, tool-catalog.js).
//
// Zero runtime dependencies, zero I/O, zero DOM/Electron API — importable
// unchanged from the browser bundle, from plain Node (vitest, the bridge
// adapter) and, eventually, from inside an asar.
//
// `bridgeNote` is inert for WebMCP (the web build never reads it) and is
// surfaced by the adapter's tools/list response so an LLM client understands
// why a bridge tool call may take a while: a human has to click "Wyślij" /
// "Zapisz" in a gate window before any result comes back (MOST-IMPL-PLAN.md
// §3 M6 / MCP-BRIDGE-DESIGN.md §5.3).

const BRIDGE_NOTE = 'odpowiedź wymaga zatwierdzenia przez użytkownika w oknie aplikacji – może chwilę potrwać';

// Manual, dependency-free length limits (MOST-IMPL-PLAN.md §4.3 / R-6).
// Shared by validateToolArgs below (adapter-side early rejection) and,
// later, by the Electron main-process gate — the same numbers enforced on
// both sides of the pipe is the point (defense in depth, not two policies).
export const ARG_LIMITS = Object.freeze({
  id: 128,
  label: 200,
  text: 2 * 1024 * 1024, // 2 MiB
});

function tool(def) {
  return Object.freeze({ ...def, inputSchema: Object.freeze(def.inputSchema), bridgeNote: BRIDGE_NOTE });
}

export const TOOL_CATALOG = Object.freeze([
  tool({
    name: 'list_sources',
    description: 'Wypisz gotowe zanonimizowane dokumenty źródłowe. Zwraca id, label i char_count dla każdego dokumentu. label to nazwa syntetyczna (np. „Źródło 1") albo nazwa jawnie udostępniona przez użytkownika — nigdy surowa nazwa pliku. Źródła bez wykrytych encji nie są udostępniane przez MCP, bo nie można potwierdzić tokenizacji.',
    inputSchema: { type: 'object', properties: {} },
  }),
  tool({
    name: 'read_source',
    description: 'Odczytaj tokenizowaną treść pojedynczego dokumentu źródłowego po id. Źródła bez wykrytych encji zwracają błąd zamiast tekstu, bo nie można potwierdzić anonimizacji.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  }),
  tool({
    name: 'list_outcomes',
    description: 'Wypisz dokumenty wynikowe w formie tokenów. Zwraca id, label i char_count. label to nazwa syntetyczna (np. „Wynik 1") albo nazwa nadana przez asystenta — nigdy prywatna nazwa użytkownika. Wyniki bez tokenów anonimizacji nie są udostępniane przez MCP.',
    inputSchema: { type: 'object', properties: {} },
  }),
  tool({
    name: 'read_outcome',
    description: 'Odczytaj tokenizowaną treść dokumentu wynikowego po id (wcześniejsza odpowiedź LLM). Wyniki bez tokenów anonimizacji zwracają błąd zamiast tekstu.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  }),
  tool({
    name: 'write_outcome',
    description: 'Utwórz lub zaktualizuj dokument wynikowy. Podaj id, aby zaktualizować istniejący dokument; pomiń id, aby utworzyć nowy. text MUSI być w formie tokenów (np. [PERSON_NAME_1]); przeglądarka deanonimizuje go tylko dla użytkownika i nigdy nie zwraca PII.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, label: { type: 'string' }, text: { type: 'string' } },
      required: ['label', 'text'],
    },
  }),
]);

export function getToolDefinition(name) {
  return TOOL_CATALOG.find((t) => t.name === name);
}

// Manual schema validator (no ajv, zero dependencies — MOST-IMPL-PLAN.md
// §3 M6: "ręczna walidacja (bez ajv, zero zależności)"). Deliberately narrow:
// it only understands the shapes the five tools actually declare (flat
// object of optional/required string properties), because that's the
// complete argument surface of this bridge — a generic JSON-Schema validator
// would be more code to audit for no behavioural gain.
//
// Used both by the adapter (electron/bridge/mcp-stdio.mjs, cheap early
// rejection before anything crosses the pipe) and, later, by the Electron
// main process as defense in depth before ever invoking the renderer
// (C-BR-10) — one function, two call sites, same limits.
export function validateToolArgs(name, args) {
  const def = getToolDefinition(name);
  if (!def) return { ok: false, error: 'nieznane narzędzie' };
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: 'nieprawidłowe argumenty' };
  }

  const { properties, required = [] } = def.inputSchema;
  const allowedKeys = new Set(Object.keys(properties));

  for (const key of Object.keys(args)) {
    if (!allowedKeys.has(key)) return { ok: false, error: 'nieprawidłowe argumenty' };
  }
  for (const key of required) {
    if (!(key in args)) return { ok: false, error: 'nieprawidłowe argumenty' };
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    // Every declared property in this catalog is a string; a non-string
    // value (including one supplied for an optional field) is rejected
    // rather than coerced — silent coercion is exactly the kind of "helpful"
    // behaviour that turns into a smuggling channel at a trust boundary.
    if (properties[key]?.type === 'string' && typeof value !== 'string') {
      return { ok: false, error: 'nieprawidłowe argumenty' };
    }
    if (key === 'id' && typeof value === 'string' && value.length > ARG_LIMITS.id) {
      return { ok: false, error: 'nieprawidłowe argumenty' };
    }
    if (key === 'label' && typeof value === 'string' && value.length > ARG_LIMITS.label) {
      return { ok: false, error: 'nieprawidłowe argumenty' };
    }
    if (key === 'text' && typeof value === 'string' && value.length > ARG_LIMITS.text) {
      return { ok: false, error: 'nieprawidłowe argumenty' };
    }
  }
  return { ok: true };
}
