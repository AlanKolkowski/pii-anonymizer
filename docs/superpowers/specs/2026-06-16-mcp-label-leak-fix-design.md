# Design: stop document labels leaking across the MCP boundary

- **Issue:** [#13 — Privacy: raw upload filename crosses the MCP boundary untokenized](https://github.com/wjarka/pii-anonymizer/issues/13) (severity: high; adversarial-review finding H4)
- **Date:** 2026-06-16
- **Scope:** MCP boundary only (`list_sources`, `list_outcomes`), the data model that feeds them, the UI control that lets a user set an assistant-visible label, the documentation guarantees, and tests.

## Problem

The WebMCP integration anonymizes document **bodies** but emits document **labels** verbatim across the boundary.

- `list_sources` (`src/main.js:1541-1548`) tokenizes `s.text` via `applyTokens` but returns `s.label` unchanged:

  ```js
  const anonymized = applyTokens(s.text, s.entities, seen);
  return { id: s.id, label: s.label, char_count: anonymized.length };
  ```

- For uploaded files, `s.label` is the raw filename (`src/main.js:499`): `const label = file.name || ...`. So `Jan_Kowalski_pozew.pdf` is JSON-serialized and sent over the WebSocket (`public/webmcp.js:1561`, `socket.send(JSON.stringify(message))`) to the third-party relay and the LLM, in cleartext.
- `list_outcomes` (`src/main.js:1570`) has the identical shape and returns `o.label` verbatim.

This contradicts the product's stated guarantees:
- `docs/webmcp.md:3` — "Przez MCP przechodzą wyłącznie teksty w formie tokenów … Legenda oraz deanonimizacja zostają w przeglądarce."
- `CLAUDE.md:90` — "All WebMCP traffic is tokenized text; PII never crosses the MCP boundary."
- `list_sources` tool description (`src/main.js:1539`) — "Treść jest tokenizowana — PII nigdy nie opuszcza przeglądarki."

### Constraints discovered during investigation

- **NER is worker-only and async** (`src/worker.js:411`). `applyTokens` requires pre-computed entity char-spans; there is **no synchronous, browser-side way to tokenize an arbitrary label string** inside an MCP handler. Filenames are not sentences, so the segmentation/NER pipeline is also unreliable on them, and regex-only scrubbing has recall gaps (cf. issue #25). → "Tokenize the label" is rejected as the primary mechanism.
- **Labels reach the boundary from three paths:** file upload (`file.name` — leaks), paste (`nextPasteLabel()` → synthetic `Wklejony tekst N`, `src/main.js:485-492` — safe), and user rename (`onRename`, `src/main.js:400-403`; UI in `src/ui/sources-list/index.js:420-435` — arbitrary, can leak).
- **The LLM addresses documents by `id`** (a `crypto.randomUUID()`), never by label. The label is purely descriptive, so replacing it does not break the read/write workflow.
- **No tests** exist for any MCP handler. `src/anonymizer.test.js` covers `applyTokens`/`buildTokenMapMulti` only.

## Decision

Adopt **synthetic relabel with an optional, explicitly-marked assistant-visible label** (user's choice):

> The MCP boundary emits **only** a dedicated `mcpLabel` field. It defaults to a synthetic placeholder (`Źródło N` / `Wynik N`) and is never derived from a filename. The user may override it through a UI control that explicitly states the text is visible to the assistant. The private display label (real filename / user's own name) never crosses the boundary.

Rejected alternatives:
- **Scrub/tokenize labels** — infeasible synchronously (NER is worker-only), unreliable on filenames, weaker guarantee.
- **Pure provenance-based hybrid** (pass through "provably synthetic" labels, synthesize only filenames/renames) — more state, no stronger guarantee than the dedicated-field model below.

## Detailed design

### 1. Data model — split the label into two fields

Every source and outcome carries:

- `label` — **browser-only display name** (unchanged role). Uploads → `file.name`; paste → `Wklejony tekst N`; outcomes → as today; user renames mutate this. **Never crosses MCP.**
- `mcpLabel` (new) — **assistant-visible label**. The only label field the MCP handlers emit. Defaults to a stable synthetic value. Only ever contains: app-generated text, an LLM-authored label (outcomes), or user text set via the explicit assistant-visible control.

Source object becomes `{ id, label, mcpLabel, text, entities, meta, status, error, lastReadyText }`. Outcome object becomes `{ id, label, mcpLabel, text }`.

### 2. MCP handlers — the actual fix

- `list_sources` (`src/main.js:1541-1548`): emit `{ id, label: s.mcpLabel, char_count }`.
- `list_outcomes` (`src/main.js:1570`): emit `{ id, label: o.mcpLabel, char_count }`.
- The response **field name stays `label`** — the LLM-facing contract/schema is unchanged; only the *source* of the value changes to the safe field.
- `read_source` / `read_outcome` are unchanged (text is already tokenized).
- `write_outcome` (`src/main.js:1600-1614`): the LLM-supplied `label` seeds **both** the new outcome's `mcpLabel` (the LLM authored it → it is already model-visible → safe to echo back via `list_outcomes`) and the display `label`.

### 3. Synthetic assignment — stable across calls

- Assign `mcpLabel = 'Źródło ' + N` for sources / `'Wynik ' + N` for outcomes **at creation time**, where `N` comes from a **monotonic counter**, not recomputed from array position. Position-based numbering renumbers survivors when an item is removed and would reintroduce the identity-swap class of bug seen in #30. A stable counter lets the assistant refer to "Źródło 2" consistently across `list_*` calls.

### 4. UI — assistant-visible alias control

- The source card keeps its private display name; the **existing rename edits this** (browser-only, no leak).
- Add a small affordance displaying the assistant-visible alias (default `Źródło N`) with an explicit marker — e.g. **"Widoczne dla asystenta"**. Editing it sets `mcpLabel`. Empty/whitespace input falls back to the synthetic default.
- The control's copy must make clear that text entered there **leaves the browser and is seen by the assistant** — this is the user's informed opt-in to sharing a human-readable name.

### 5. Documentation & tool descriptions — reconcile the guarantee

Make the guarantee **true by construction** rather than aspirational:
- `docs/webmcp.md:3`, `CLAUDE.md:90`, and the `list_sources` / `list_outcomes` / `write_outcome` description strings (`src/main.js:1539,1568,1590`) updated to state: document **bodies** are tokenized and never cross; the only human-readable **label** the assistant sees is a synthetic placeholder **or** a label the user explicitly chose to share.

### 6. Tests — new (none exist for MCP handlers)

- **Testability refactor (in scope):** extract the listing logic from the inline closures in `main.js` into small pure functions — e.g. `buildSourceListing(sources, seen)` and `buildOutcomeListing(outcomes)` — so the boundary output is unit-testable without a live WebMCP connection.
- Tests to add:
  - A source with `label = 'Jan_Kowalski_pozew.pdf'` and default `mcpLabel = 'Źródło 1'` → listing emits `label: 'Źródło 1'`, and **never** the filename.
  - A user-set `mcpLabel` is what the listing emits.
  - `list_outcomes` parallel: emits `mcpLabel`; an LLM-authored outcome label round-trips, a user *display* rename does not change what crosses.
  - Guard: no listing path emits `source.label` / `outcome.label`.

## Edge cases & decisions

- **Empty/whitespace custom alias** → fall back to the synthetic default.
- **Source removal** → never renumber existing `mcpLabel`s (stable counter, per §3).
- **Outcome user-rename** → changes the private display `label` only, not `mcpLabel` (settled sub-decision (a)).
- **Field name** → `mcpLabel` (settled sub-decision (b)).
- **char_count / id** remain safe: `char_count` is derived from anonymized/token text length; `id` is an opaque UUID.

## Non-goals (explicitly out of scope for #13)

- Deanon **export filenames** built from raw labels (`src/export/deanon.js:45`) — a browser-local surface, not the MCP boundary.
- Hardening the rename path beyond the display/`mcpLabel` split.
- Other adversarial-review findings (#14, #16, #21, #25, etc.).

## Affected files

- `src/main.js` — source/outcome creation (add `mcpLabel`), `list_sources`/`list_outcomes` handlers, `write_outcome`, tool description strings, paste/file/rename paths.
- `src/ui/sources-list/index.js` — assistant-visible alias control.
- `src/ui/outcomes-coordinator.js`, `src/ui/outcomes-list/index.js` — outcome `mcpLabel` plumbing.
- New module for extracted listing functions (e.g. `src/mcp/listings.js`) + its test file.
- `docs/webmcp.md`, `CLAUDE.md` — guarantee wording.
