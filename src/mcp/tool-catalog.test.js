import { TOOL_CATALOG, ARG_LIMITS, getToolDefinition, validateToolArgs } from './tool-catalog.js';

// MOST-IMPL-PLAN.md R-2: tool-catalog.js is the ONE source of truth for the
// five MCP tool definitions, consumed both by src/main.js's WebMCP
// registrations (web build) and, later, by the desktop bridge adapter's
// tools/list (packaged inside app.asar per R-3). These literal strings are
// pinned here as the "parity by construction" proof: if src/main.js and this
// catalog ever disagree, it's because someone edited the string in only one
// place — this test (plus the catalog being the only place main.js reads
// from) is what makes that impossible instead of just detectable.
const EXPECTED = {
  list_sources: {
    description: 'Wypisz gotowe zanonimizowane dokumenty źródłowe. Zwraca id, label i char_count dla każdego dokumentu. label to nazwa syntetyczna (np. „Źródło 1") albo nazwa jawnie udostępniona przez użytkownika — nigdy surowa nazwa pliku. Źródła bez wykrytych encji nie są udostępniane przez MCP, bo nie można potwierdzić tokenizacji.',
    inputSchema: { type: 'object', properties: {} },
  },
  read_source: {
    description: 'Odczytaj tokenizowaną treść pojedynczego dokumentu źródłowego po id. Źródła bez wykrytych encji zwracają błąd zamiast tekstu, bo nie można potwierdzić anonimizacji.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  list_outcomes: {
    description: 'Wypisz dokumenty wynikowe w formie tokenów. Zwraca id, label i char_count. label to nazwa syntetyczna (np. „Wynik 1") albo nazwa nadana przez asystenta — nigdy prywatna nazwa użytkownika. Wyniki bez tokenów anonimizacji nie są udostępniane przez MCP.',
    inputSchema: { type: 'object', properties: {} },
  },
  read_outcome: {
    description: 'Odczytaj tokenizowaną treść dokumentu wynikowego po id (wcześniejsza odpowiedź LLM). Wyniki bez tokenów anonimizacji zwracają błąd zamiast tekstu.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  write_outcome: {
    description: 'Utwórz lub zaktualizuj dokument wynikowy. Podaj id, aby zaktualizować istniejący dokument; pomiń id, aby utworzyć nowy. text MUSI być w formie tokenów (np. [PERSON_NAME_1]); przeglądarka deanonimizuje go tylko dla użytkownika i nigdy nie zwraca PII.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, label: { type: 'string' }, text: { type: 'string' } },
      required: ['label', 'text'],
    },
  },
};

describe('TOOL_CATALOG shape', () => {
  it('lists exactly the five tools, in a stable order', () => {
    expect(TOOL_CATALOG.map((t) => t.name)).toEqual([
      'list_sources',
      'read_source',
      'list_outcomes',
      'read_outcome',
      'write_outcome',
    ]);
  });

  it('is frozen (catalog and every entry) so no caller can mutate the shared source of truth', () => {
    expect(Object.isFrozen(TOOL_CATALOG)).toBe(true);
    for (const tool of TOOL_CATALOG) expect(Object.isFrozen(tool)).toBe(true);
  });

  it.each(Object.keys(EXPECTED))('pins the exact description and inputSchema for %s (parity with the pre-catalog src/main.js literal)', (name) => {
    const tool = getToolDefinition(name);
    expect(tool.description).toBe(EXPECTED[name].description);
    expect(tool.inputSchema).toEqual(EXPECTED[name].inputSchema);
  });

  it('gives every tool a non-empty bridgeNote (R-2: adapter tools/list surfaces this so an LLM understands gate latency)', () => {
    for (const tool of TOOL_CATALOG) {
      expect(typeof tool.bridgeNote).toBe('string');
      expect(tool.bridgeNote.length).toBeGreaterThan(0);
    }
  });

  it('getToolDefinition returns undefined for an unknown name (closed list, no silent fallback)', () => {
    expect(getToolDefinition('delete_everything')).toBeUndefined();
  });
});

describe('validateToolArgs', () => {
  it('accepts empty args for list_sources / list_outcomes', () => {
    expect(validateToolArgs('list_sources', {})).toEqual({ ok: true });
    expect(validateToolArgs('list_outcomes', {})).toEqual({ ok: true });
  });

  it('rejects an unknown tool name (closed list of 5)', () => {
    const result = validateToolArgs('rm_rf', {});
    expect(result.ok).toBe(false);
  });

  it('requires id for read_source / read_outcome', () => {
    expect(validateToolArgs('read_source', {}).ok).toBe(false);
    expect(validateToolArgs('read_source', { id: 's1' })).toEqual({ ok: true });
  });

  it('rejects a non-string id', () => {
    expect(validateToolArgs('read_source', { id: 123 }).ok).toBe(false);
  });

  it(`rejects an id longer than ARG_LIMITS.id (${128})`, () => {
    expect(validateToolArgs('read_source', { id: 'a'.repeat(ARG_LIMITS.id) }).ok).toBe(true);
    expect(validateToolArgs('read_source', { id: 'a'.repeat(ARG_LIMITS.id + 1) }).ok).toBe(false);
  });

  it('rejects extra/unexpected fields (closed schema, no silent pass-through)', () => {
    expect(validateToolArgs('read_source', { id: 's1', extra: 'nope' }).ok).toBe(false);
  });

  it('write_outcome requires label and text but id is optional', () => {
    expect(validateToolArgs('write_outcome', { label: 'Wynik 1', text: '[PERSON_NAME_1]' })).toEqual({ ok: true });
    expect(validateToolArgs('write_outcome', { text: '[PERSON_NAME_1]' }).ok).toBe(false);
    expect(validateToolArgs('write_outcome', { label: 'Wynik 1' }).ok).toBe(false);
    expect(validateToolArgs('write_outcome', { id: 'o1', label: 'Wynik 1', text: 'x' })).toEqual({ ok: true });
  });

  it(`rejects label longer than ARG_LIMITS.label (${200}) and text longer than ARG_LIMITS.text`, () => {
    expect(validateToolArgs('write_outcome', { label: 'a'.repeat(201), text: 'x' }).ok).toBe(false);
    expect(validateToolArgs('write_outcome', { label: 'x', text: 'a'.repeat(ARG_LIMITS.text + 1) }).ok).toBe(false);
  });

  it('rejects wrong-typed values even when the field is optional', () => {
    expect(validateToolArgs('write_outcome', { id: 42, label: 'x', text: 'y' }).ok).toBe(false);
  });
});
