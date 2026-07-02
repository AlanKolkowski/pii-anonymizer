import { applyTokens } from '../anonymizer.js';

// Payload for the `list_sources` MCP tool. Only `mcpLabel` (a synthetic or
// user-shared name) crosses the boundary — never the private `label`, which may
// be a raw upload filename. `char_count` is derived from the tokenized text so
// it never reflects raw PII length.
//
// Precondition: `seen` must contain a token for every entity in the ready
// sources; otherwise `applyTokens` leaves that span untokenized and its raw PII
// length leaks into `char_count`. The production caller satisfies this by
// building `seen` from those same ready sources.
function jsonContent(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function textContent(value) {
  return { content: [{ type: 'text', text: value }] };
}

function hasDetectedEntities(source) {
  return Array.isArray(source.entities) && source.entities.length > 0;
}

function isReadableSource(source) {
  return source?.status === 'ready' && hasDetectedEntities(source);
}

const TOKEN_PATTERN = /\[[A-Z][A-Z0-9_]*_\d+\]/;

function hasAnonymizationToken(text) {
  return typeof text === 'string' && TOKEN_PATTERN.test(text);
}

export function buildSourceListing(sources, seen) {
  return sources
    .filter(isReadableSource)
    .map((s) => ({
      id: s.id,
      label: s.mcpLabel,
      char_count: applyTokens(s.text, s.entities, seen).length,
    }));
}

// Payload for the `read_source` MCP tool. A ready source with zero detected
// entities is not safe to expose: tokenization would be an identity transform,
// so any model/regex recall miss would cross the MCP boundary as raw text.
export function buildReadSourceContent(sources, seen, id) {
  const source = sources.find((x) => x.id === id);
  if (!source || source.status !== 'ready') {
    return jsonContent({ error: `Dokument źródłowy ${id} nie jest gotowy` });
  }
  if (!hasDetectedEntities(source)) {
    return jsonContent({
      error: `Dokument źródłowy ${id} nie zawiera wykrytych encji; nie można bezpiecznie udostępnić treści przez MCP`,
    });
  }
  return textContent(applyTokens(source.text, source.entities, seen));
}

// Payload for the `list_outcomes` MCP tool. Emits only outcomes that still
// contain anonymization tokens; tokenless freeform text may be raw user data
// pasted into the outcome workspace, so it cannot cross the MCP boundary.
export function buildOutcomeListing(outcomes) {
  return outcomes
    .filter((o) => hasAnonymizationToken(o.text))
    .map((o) => ({
      id: o.id,
      label: o.mcpLabel,
      char_count: o.text.length,
    }));
}

// Payload for the `read_outcome` MCP tool. Outcomes are assistant-authored or
// user-pasted freeform text, so tokenless outcomes are treated as unreadable
// rather than echoed back over MCP.
export function buildReadOutcomeContent(outcomes, id) {
  const outcome = outcomes.find((x) => x.id === id);
  if (!outcome) return jsonContent({ error: `Dokument wynikowy ${id} nie istnieje` });
  if (!hasAnonymizationToken(outcome.text)) {
    return jsonContent({
      error: `Dokument wynikowy ${id} nie zawiera tokenów anonimizacji; nie można bezpiecznie udostępnić treści przez MCP`,
    });
  }
  return textContent(outcome.text);
}

// Stable, monotonically increasing synthetic labels ("Źródło 1", "Źródło 2", …).
// Never reuses or renumbers an already-assigned value, so removing a document
// cannot swap one document's assistant-visible name onto another.
export function createLabelSequence(prefix) {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix} ${n}`;
  };
}
