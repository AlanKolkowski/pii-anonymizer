# Multi-document support — design

**Status:** approved (brainstorming)
**Date:** 2026-05-08

## Goal

Generalize the anonymizer from one-document-at-a-time to N documents sharing a single anonymization namespace, so an LLM client (via WebMCP) can read several anonymized sources, do work over them, and write back one or more tokenized outputs that are deanonymized in the browser.

Concretely:

1. The user can stage multiple input documents (paste or file upload, mixed).
2. A single "Anonimizuj" action processes all staged docs and produces a **shared legend**: tokens are unique across the whole batch, so the same person/organization in two docs gets the same token.
3. Annotation edits on any source live-update the shared legend (matching today's single-doc reactivity).
4. WebMCP exposes the batch as five tools split between *sources* (user-supplied input, in token form) and *outcomes* (LLM-produced text, also in token form, deanonymized in the browser for the user only).

The data layer and WebMCP shape are designed to outlive the in-flight UI redesign — the v1 UI is an explicitly minimal scaffolding around the same data model.

## Non-goals (v1)

- **Persistence across reloads.** Sources, outcomes, legend — all in-memory only. Matches today. IndexedDB persistence is a future increment.
- **Per-document entity selection.** A single global entity selection applies to every source, as today. No per-source overrides.
- **Cross-machine token portability.** Token IDs are session-scoped; reload starts fresh.
- **Outcomes structurally bound to sources.** An outcome may correspond to a specific source ("rewrite of umowa.docx") or be free-form ("comparison memo"). The system does not enforce a 1:1 mapping.
- **LLM ever seeing PII.** The MCP boundary only carries tokenized text in either direction. Deanonymized renderings stay client-side and are never returned through any tool.
- **Streaming progress UI for multi-doc anonymization.** A simple aggregate "Anonimizowanie X / N…" status is enough; per-source progress bars are out of scope.
- **UI redesign.** The user has a separate UI redesign queued. The v1 UI here is a deliberate placeholder that exposes the new data model on the existing layout. The redesign will replace it.

## Glossary

- **Source** — a user-supplied input document. Has raw text + post-pipeline entities. Anonymized rendering is derived (text - tokens applied via shared legend).
- **Outcome** — LLM-produced text in tokenized form. Deanonymized rendering (PII restored) is derived for the user; never exposed via MCP.
- **Legend** — `{ token: original_value }` map shared across all sources. Built from the union of every source's entities.

## Architecture

### Data model

Two new module-level collections in `src/main.js` replace today's `currentLegend` / `currentAnonymized` globals:

```js
let sources = [];
// Source: {
//   id: string,                  // crypto.randomUUID()
//   label: string,               // filename for uploads, "Wklejony tekst N" for pastes; user-renamable
//   text: string,                // raw input
//   entities: Entity[],          // post-pipeline; [] until classified
//   meta: object | null,         // file-import metadata (filename, OCR pages, etc.)
//   status: 'idle' | 'pending' | 'ready' | 'error',
//   error: string | null,
// }

let outcomes = [];
// Outcome: {
//   id: string,                  // crypto.randomUUID() (server-generated for MCP create)
//   label: string,               // user- or LLM-supplied
//   text: string,                // tokenized form (the LLM's own output)
//   // deanonymized text is recomputed from `text` + `legend` on every render
// }

let legend = {};                  // { token: originalValue } across all sources
let lastRun = null;               // Map<sourceId, { text: string }> + enabledEntities: string[];
                                  //   used to compute per-source staleness for "Anonimizuj ponownie".
```

Anonymized text per source is computed on demand from `(source.text, source.entities, sharedSeenMap)`; it is not stored. Same for an outcome's deanonymized rendering.

`Entity` shape is unchanged: `{ entity_group, start, end, score, source }`. Entities are stored *per source*, not in a global pool — the union is computed only at legend-rebuild time.

### Token rebuild

Today's `buildTokenMap(entities, originalText)` (in `src/anonymizer.js`) is single-text. We generalize it without changing its behavior in the single-doc case:

```js
// New: src/anonymizer.js
export function buildTokenMapMulti(entitiesBySource) {
  // entitiesBySource: Array<{ text: string, entities: Entity[] }>
  // Order is significant — earlier sources get lower token numbers for unique values.
  // Within a source, entities are processed in start-order (existing behavior).
  // Returns the same shape as buildTokenMap: { seen, legend }.
}

// New: applies an already-built `seen` map to a single text+entities pair.
export function applyTokens(text, entities, seen) {
  // Lifted from anonymizeText(); same right-to-left replacement.
}

// Existing anonymizeText becomes a thin wrapper:
export function anonymizeText(text, entities) {
  const { seen, legend } = buildTokenMap(entities, text);
  return { anonymized: applyTokens(text, entities, seen), legend };
}
```

The existing fuzzy `couldBeSamePerson` and the `ORGANIZATION_NAME` lowercase normalization carry over unchanged — they already handle the "Jan Kowalski" / "Janowi Kowalskiemu" case across sources because the canonical key is built per-type-per-normalized-value, independent of which source the entity came from.

**Rebuild ordering rule:** sources are processed in the order they appear in the `sources` array (insertion order). Within a source, entities are processed by `start` ascending. This determines token numbering deterministically. Token numbers may shift when a source is added before existing sources or removed; documenting that as expected behavior, not a bug. (The C-strict / C-live discussion in brainstorming concluded numbering churn on add/remove is acceptable for v1.)

**Legend rebuild triggers:**

- A source's classification result arrives from the worker (status flips to `ready`).
- A source's entities are mutated by the annotation editor (`onChange`).
- A `ready` source is removed.

**No legend rebuild for:**

- Adding an empty source (no entities to contribute).
- Renaming a source's label (legend unaffected; only the UI source-list re-renders).
- A source entering `pending` or `error` state (no entity changes contributed).

`refreshLegend()` rebuilds `seen` + `legend` from `sources.filter(s => s.status === 'ready')` and re-renders the legend table + every visible anonymized rendering.

### Anonymization flow

The worker stays single-text-per-classify. Multi-doc orchestration lives in `main.js`:

1. User clicks "Anonimizuj" (top-level button, replaces today's per-workspace button).
2. main.js iterates `sources` and posts one `{type:'classify', id, text}` message per source. The new `id` field is echoed back on the result so main.js can route.
3. Worker processes them serially (it's single-threaded; the existing classify function runs to completion before pulling the next message).
4. Per result, main.js stores `entities` on the matching source, marks it `ready`, calls `refreshLegend()` (so the user sees results stream in).
5. When all sources reach a terminal state (`ready` or `error`), the run is complete. `lastRun` is updated. The "Anonimizuj ponownie" button appears for sources whose text or selection drifted.

Errors per source are isolated: one source failing does not abort the others.

### Worker cache change

Today (`src/worker.js`):
```js
let nerCache = null;  // single slot keyed by content hash
```

Change to:
```js
let nerCache = new Map();  // textHash -> CacheEntry
```

`classifyWithCache` already keys lookups by content hash (`src/pipeline/cache-orchestrator.js`). The only change is the storage: instead of overwriting the single slot, write into the map. Lookups become `nerCache.get(textHash)` instead of `nerCache?.textHash === textHash ? nerCache : null`.

**Eviction:** none in v1. A 30-page document's cached entries are kilobytes; even 50 docs is well under any meaningful memory pressure. If we ever need it, an LRU cap is straightforward to bolt on.

**Invalidation:**
- Backend override change → clear the entire map (same as today, just `.clear()` instead of `= null`).
- Worker reload → gone naturally.
- Source removed from UI → optionally evict the entry, but cheaper to leave it; if the user re-adds the same text it's an instant hit.

### WebMCP tools

All five tools operate on tokenized text. The MCP boundary never carries PII. Tool descriptions state this explicitly so the model doesn't get confused about the directionality.

```
list_sources()
  → { content: [{ type: "text", text: JSON.stringify([{ id, label, char_count }, ...]) }] }
  Returns metadata for every source in `ready` status.
  Sources in `idle` / `pending` / `error` are omitted (no usable anonymized text).

read_source({ id })
  → { content: [{ type: "text", text: <anonymized text in token form> }] }
  Errors if id is unknown or source isn't ready yet.

list_outcomes()
  → { content: [{ type: "text", text: JSON.stringify([{ id, label, char_count }, ...]) }] }

read_outcome({ id })
  → { content: [{ type: "text", text: <tokenized text> }] }
  Returns the LLM's own output as it was last written. Errors if id is unknown.

write_outcome({ id?, label, text })
  → { content: [{ type: "text", text: JSON.stringify({ id, success: true }) }] }
  Upsert: id present → update existing outcome; id absent → create with a new server-generated id.
  `text` must be in token form. Browser deanonymizes it for display only.
  Returns the (possibly new) id so the LLM can update the same outcome later.
```

The two existing tools (`read_anonymized_text`, `write_deanonymize_text`) are **removed**. They are not generalizations of the new tools — the naming was semantically wrong (the LLM never had access to PII, so it wasn't "writing deanonymized text") and the new shape is strictly more capable.

Validation:
- `write_outcome` rejects empty `label` (forces meaningful identification).
- `write_outcome` does not validate that `text` parses as legal token-text — it accepts free text and lets `deanonymizeText` no-op on anything that isn't a known token. Matches today's tolerance.
- `id` formats are server-generated; clients that fabricate ids get a "no such outcome" error on update attempts.

### UI (minimal stopgap)

The workspace today is a single-instance file-pill + annotation editor. For v1, the existing `createWorkspace` becomes a per-source factory; the page hosts a vertical list of source cards.

```
[ entity selector — unchanged ]
[ + Dodaj dokument ▾ ]   [ Anonimizuj ]   [ status: 2/3 gotowe ]
┌─ Source card ─────────────────────────────────┐
│ 📄 umowa.docx · OCR  [Zmień nazwę] [Usuń]      │
│ <annotation editor>                            │
└────────────────────────────────────────────────┘
┌─ Source card ─────────────────────────────────┐
│ ✏️ Wklejony tekst 1  [Zmień nazwę] [Usuń]       │
│ <annotation editor>                            │
└────────────────────────────────────────────────┘

[ Legenda — unchanged shape, now spans all sources ]

[ Wyniki LLM (outcomes) ]
┌─ Outcome card ────────────────────────────────┐
│ Pismo procesowe  [Zmień nazwę] [Usuń]         │
│ <deanonymized text rendering>  [Kopiuj]       │
└────────────────────────────────────────────────┘
```

Specifics:

- **"Dodaj dokument" menu** has two actions: "Wgraj plik" (opens file picker, multiple selection accepted) and "Wklej tekst" (creates an empty source labeled "Wklejony tekst N" and focuses its editor in text mode).
- **Drag-and-drop** on the page background creates new sources, one per file.
- **Inline rename**: click the label, edit, blur to commit. Empty labels revert to the previous value.
- **Remove**: confirmation dialog if the source has classified entities (lest the user lose work). No confirmation for empty/idle sources.
- **Single global "Anonimizuj"** button, top of page. Disabled while a run is in flight or no sources are staged. Replaces per-source anonymize.
- **"Anonimizuj ponownie"** appears per source when *that source's* text or the global selection drifted from `lastRun`. Same staleness logic as today, just per source.
- **No `deanonymize-input` textarea anymore.** The manual-paste flow is replaced by outcome cards driven through MCP. (If we later want a "paste an LLM response manually" affordance, it becomes "create a new outcome by paste" — same code path.)
- **Outcome cards** render the deanonymized text live (recomputed from `text + legend` on every render, no caching). Copy button copies the deanonymized form. Outcomes are read-only in the UI for v1 — they are write-only via MCP. (Manual edit of tokenized text is a future affordance; not needed for the MCP-driven flow.)

This UI is intentionally not polished — the redesign will rework layout, navigation between sources, and outcome presentation. What needs to outlive the redesign is the data layer and the MCP shape; both are isolated from these DOM details.

### Module boundaries

| Module | Role | Multi-doc change |
|---|---|---|
| `src/anonymizer.js` | Pure token logic | Add `buildTokenMapMulti`, `applyTokens`. Existing `anonymizeText` becomes a single-source wrapper. |
| `src/pipeline/*` | NER / postprocess pipeline | **No change.** Operates on a single text per call. |
| `src/pipeline/cache-orchestrator.js` | Cache lookups | **No change.** Still keyed by content hash. |
| `src/worker.js` | Pipeline driver | Cache: `null` → `Map`. Classify accepts optional `id`, echoes it on result. |
| `src/main.js` | Page orchestration | Largest change: source/outcome state arrays, multi-classify dispatch, legend rebuild, MCP tool re-registration. |
| `src/ui/workspace/index.js` | Per-doc workspace | Becomes a per-*source* component (one instance per card). API surface unchanged; multiple instances coexist. |
| `src/ui/sources-list/` | New module | List/add/remove/rename of source cards. Hosts N workspace instances. |
| `src/ui/outcomes-list/` | New module | List/render/edit outcome cards. |
| `index.html` | Layout | Drop the `deanonymize-section` and `deanonymize-result-section`; add containers for sources-list and outcomes-list. |

### Testing

- **`anonymizer.test.js`** — add cases for `buildTokenMapMulti`:
  - Same `PERSON_NAME` value across two sources → single token (number `_1`), legend has one entry.
  - Polish declension across sources ("Jan Kowalski" in source A, "Janowi Kowalskiemu" in source B) → single token.
  - Source order determines numbering (swap source order → token numbers swap).
  - Empty sources / sources with no entities → no tokens contributed.
  - `applyTokens` reuses the shared `seen` map correctly across sources.
- **`worker.js`** — covered indirectly by existing pipeline tests; the only change is the cache container, which doesn't affect classification semantics. Add one targeted unit test for the `Map` cache (two distinct text hashes → two entries, both retrievable).
- **MCP tools** — manual verification via the WebMCP widget (no automated harness for MCP today).
- **Eval & bench** — unchanged. Eval still operates on single documents; multi-doc is a UI/orchestration concern, not a model concern. Run `npm run eval -- --label=multi-doc-baseline` after the data-layer changes to confirm no regression on the single-doc path.

### Migration / breakage

- The two old MCP tools are removed. Anyone with an LLM client wired to `read_anonymized_text` / `write_deanonymize_text` must re-point to the new tools. There is no compatibility shim — the project is pre-1.0 and the user's only MCP consumer is the user themselves.
- The deanonymize textarea + result section disappear from the UI. Manual deanonymization (paste an LLM response) is no longer a primary flow; it can be reintroduced later as a "create outcome by paste" affordance if needed.
- Per-source "Anonimizuj ponownie" staleness extends today's logic: instead of comparing one `(text, enabledEntities)` pair to `lastRun`, each source compares its own text against `lastRun.get(sourceId)?.text` and the global selection against `lastRun.enabledEntities`.

## Open questions

None blocking. Items deferred for a future increment:

- IndexedDB persistence of sources + outcomes across reloads.
- Outcome ↔ source linkage (`Outcome.sourceId?` to render "rewrite of umowa.docx" hints in the UI).
- Streaming per-source progress in the UI.
- LRU cap on the worker `nerCache` map.
- A "Paste an LLM response manually" path back into outcomes for users who don't run an MCP client.
