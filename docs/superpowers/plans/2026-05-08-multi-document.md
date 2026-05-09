# Multi-document support — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the anonymizer from one document to N documents sharing a single legend, with WebMCP exposing five tools split into *sources* (user-supplied input) and *outcomes* (LLM-produced text). All MCP traffic is in token form; PII never crosses the boundary.

**Architecture:** Pure-function additions to `anonymizer.js` plus a one-line cache-shape change in the worker land first (additive, no UI break). New `sources-list` and `outcomes-list` UI modules land next, also additive. The big-bang migration of `index.html` + `src/main.js` + the WebMCP tool registration ships as a single coordinated commit because the old single-doc state and DOM disappear together. Validation closes with a tagged eval + manual smoke.

**Tech Stack:** Vanilla ESM JS, Vitest (`globals: true`), Vite, Web Worker for the model pipeline, WebMCP via `public/webmcp.js` global.

**Spec:** [`docs/superpowers/specs/2026-05-08-multi-document-design.md`](../specs/2026-05-08-multi-document-design.md)

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/anonymizer.js` | Modify | Add `applyTokens`, `buildTokenMapMulti`. Keep `anonymizeText` as wrapper. |
| `src/anonymizer.test.js` | Modify | Add cross-source tests. |
| `src/worker.js` | Modify | Cache: single slot → `Map`. Echo classify `id` on result. |
| `src/ui/sources-list/index.js` | Create | Manages a list of source cards (annotation editor + label + remove). |
| `src/ui/sources-list/styles.css` | Create | Styling for the cards list. |
| `src/ui/sources-list/sources-list.test.js` | Create | jsdom unit tests. |
| `src/ui/outcomes-list/index.js` | Create | Manages a list of outcome cards (deanonymized render + copy). |
| `src/ui/outcomes-list/styles.css` | Create | Styling. |
| `src/ui/outcomes-list/outcomes-list.test.js` | Create | jsdom unit tests. |
| `src/main.js` | Rewrite (large) | Multi-source state, multi-classify dispatch, MCP tool registration, glue between modules. |
| `index.html` | Modify | Drop deanonymize sections; replace `#workspace-root` with `#sources-list-root` + `#outcomes-list-root`; move "Anonimizuj" to top. |

The `createWorkspace` module (`src/ui/workspace/`) stays untouched and unused by the new code path. We do **not** delete it in this plan — it still has tests, and a future increment may revive parts of it (file pill, OCR progress UI). It becomes dead code on the main path; that's flagged in Task 8 for follow-up cleanup but not required for shipping.

---

## Task 1: Extract `applyTokens` from `anonymizeText`

Pure refactor. Behavior-preserving. Lays the foundation for `buildTokenMapMulti` to share the right-to-left token-replacement loop without duplication.

**Files:**
- Modify: `src/anonymizer.js`
- Modify: `src/anonymizer.test.js`

- [ ] **Step 1: Add a failing test for the new `applyTokens` export**

Append to `src/anonymizer.test.js`:

```js
describe('applyTokens', () => {
  it('replaces entities using a pre-built seen map', async () => {
    const { applyTokens, buildTokenMap } = await import('./anonymizer.js');
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 },
      { entity_group: 'ORGANIZATION_NAME', start: 22, end: 34, score: 0.95 },
    ];
    const { seen } = buildTokenMap(entities, text);
    expect(applyTokens(text, entities, seen)).toBe(
      '[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]',
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/anonymizer.test.js
```

Expected: the new `applyTokens` test fails with `applyTokens is not a function` (or undefined import). Other tests still pass.

- [ ] **Step 3: Extract `applyTokens` and rewrite `anonymizeText` as a wrapper**

In `src/anonymizer.js`, replace the existing `anonymizeText` function with:

```js
export function applyTokens(text, entities, seen) {
  const positionsSeen = new Set();
  const unique = [];
  for (const entity of entities) {
    const posKey = `${entity.start}:${entity.end}`;
    if (!positionsSeen.has(posKey)) {
      positionsSeen.add(posKey);
      unique.push(entity);
    }
  }
  unique.sort((a, b) => b.start - a.start);

  let result = text;
  for (const entity of unique) {
    const value = text.slice(entity.start, entity.end);
    const key = `${entity.entity_group}::${value}`;
    const token = seen[key];
    result = result.slice(0, entity.start) + token + result.slice(entity.end);
  }
  return result;
}

export function anonymizeText(text, entities) {
  const { seen, legend } = buildTokenMap(entities, text);
  return { anonymized: applyTokens(text, entities, seen), legend };
}
```

- [ ] **Step 4: Run all tests and confirm they pass**

```bash
npm test
```

Expected: every existing `anonymizer.test.js` case plus the new `applyTokens` case all pass.

- [ ] **Step 5: Commit**

```bash
git add src/anonymizer.js src/anonymizer.test.js
git commit -m "refactor(anonymizer): extract applyTokens from anonymizeText"
```

---

## Task 2: Add `buildTokenMapMulti`

New pure function that builds a shared `seen`+`legend` across N sources. Insertion order of sources determines token numbering. Within a source, entities are processed in the order given (existing single-doc semantics).

**Files:**
- Modify: `src/anonymizer.js`
- Modify: `src/anonymizer.test.js`

- [ ] **Step 1: Write failing tests for cross-source token sharing**

Append to `src/anonymizer.test.js`:

```js
describe('buildTokenMapMulti', () => {
  it('shares a token across sources for the same value', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = {
      text: 'Pisze Jan Kowalski.',
      entities: [{ entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.98 }],
    };
    const docB = {
      text: 'Także Jan Kowalski był obecny.',
      entities: [{ entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.97 }],
    };
    const { legend } = buildTokenMapMulti([docA, docB]);
    expect(legend).toEqual({ '[PERSON_NAME_1]': 'Jan Kowalski' });
  });

  it('reuses one token across declension forms (Polish)', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = {
      text: 'Jan Kowalski podpisał umowę.',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 }],
    };
    const docB = {
      text: 'Pełnomocnictwo dla Janowi Kowalskiemu.',
      entities: [{ entity_group: 'PERSON_NAME', start: 19, end: 37, score: 0.97 }],
    };
    const { legend } = buildTokenMapMulti([docA, docB]);
    expect(Object.keys(legend)).toHaveLength(1);
    expect(legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
  });

  it('numbers tokens in insertion order across sources', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = {
      text: 'Anna Nowak',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.98 }],
    };
    const docB = {
      text: 'Jan Kowalski',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 }],
    };
    const aFirst = buildTokenMapMulti([docA, docB]).legend;
    const bFirst = buildTokenMapMulti([docB, docA]).legend;
    expect(aFirst).toEqual({
      '[PERSON_NAME_1]': 'Anna Nowak',
      '[PERSON_NAME_2]': 'Jan Kowalski',
    });
    expect(bFirst).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[PERSON_NAME_2]': 'Anna Nowak',
    });
  });

  it('returns empty seen and legend for no sources', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    expect(buildTokenMapMulti([])).toEqual({ seen: {}, legend: {} });
  });

  it('skips sources with empty entity lists', async () => {
    const { buildTokenMapMulti } = await import('./anonymizer.js');
    const docA = { text: 'no PII here', entities: [] };
    const docB = {
      text: 'Anna Nowak',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 10, score: 0.98 }],
    };
    const { legend } = buildTokenMapMulti([docA, docB]);
    expect(legend).toEqual({ '[PERSON_NAME_1]': 'Anna Nowak' });
  });

  it('applyTokens with the multi-source seen map renders each source correctly', async () => {
    const { buildTokenMapMulti, applyTokens } = await import('./anonymizer.js');
    const docA = {
      text: 'Jan Kowalski tu jest.',
      entities: [{ entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.98 }],
    };
    const docB = {
      text: 'I Jan Kowalski tam był.',
      entities: [{ entity_group: 'PERSON_NAME', start: 2, end: 14, score: 0.97 }],
    };
    const { seen } = buildTokenMapMulti([docA, docB]);
    expect(applyTokens(docA.text, docA.entities, seen)).toBe('[PERSON_NAME_1] tu jest.');
    expect(applyTokens(docB.text, docB.entities, seen)).toBe('I [PERSON_NAME_1] tam był.');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run src/anonymizer.test.js
```

Expected: all six new `buildTokenMapMulti` tests fail with `buildTokenMapMulti is not a function`.

- [ ] **Step 3: Implement `buildTokenMapMulti` by lifting the existing tokenization loop**

In `src/anonymizer.js`, the existing `buildTokenMap` is currently:

```js
export function buildTokenMap(entities, originalText) {
  const counters = {};
  const seen = {};
  const legend = {};
  const normalizeName = createNameNormalizer();
  // ... existing loop
  return { seen, legend };
}
```

Refactor it into a single shared core, with `buildTokenMap` and the new `buildTokenMapMulti` as the public surfaces:

```js
function ingestSource({ text, entities }, state) {
  for (const entity of entities) {
    const value = text.slice(entity.start, entity.end);
    const type = entity.entity_group;
    let normalizedValue = value;
    if (type === 'PERSON_NAME') {
      normalizedValue = state.normalizeName(value);
    } else if (type === 'ORGANIZATION_NAME') {
      normalizedValue = value.toLowerCase();
    }
    const canonicalKey = `${type}::${normalizedValue}`;

    if (!state.seen[canonicalKey]) {
      state.counters[type] = (state.counters[type] || 0) + 1;
      const token = `[${type}_${state.counters[type]}]`;
      state.seen[canonicalKey] = token;
      state.legend[token] = value;
    }

    const rawKey = `${type}::${value}`;
    if (rawKey !== canonicalKey) {
      state.seen[rawKey] = state.seen[canonicalKey];
    }
  }
}

export function buildTokenMap(entities, originalText) {
  const state = {
    counters: {},
    seen: {},
    legend: {},
    normalizeName: createNameNormalizer(),
  };
  ingestSource({ text: originalText, entities }, state);
  return { seen: state.seen, legend: state.legend };
}

export function buildTokenMapMulti(sources) {
  const state = {
    counters: {},
    seen: {},
    legend: {},
    normalizeName: createNameNormalizer(),
  };
  for (const source of sources) ingestSource(source, state);
  return { seen: state.seen, legend: state.legend };
}
```

The single `normalizeName` instance is shared across sources so that fuzzy-grouping across declension forms works cross-document.

- [ ] **Step 4: Run all tests and confirm they pass**

```bash
npm test
```

Expected: all anonymizer tests (existing + new) pass.

- [ ] **Step 5: Commit**

```bash
git add src/anonymizer.js src/anonymizer.test.js
git commit -m "feat(anonymizer): add buildTokenMapMulti for cross-source legend"
```

---

## Task 3: Worker NER cache `null` → `Map`

The cache currently overwrites a single slot on every classify, so multi-doc anonymization would constantly thrash. Switch storage to a `Map<textHash, CacheEntry>`. The orchestrator's hit-check (`cache?.textHash === hash`) still works on individual entries; we just look up the entry before passing it in.

**Files:**
- Modify: `src/worker.js`

- [ ] **Step 1: Switch the import to also pull in `sha256Hex`**

In `src/worker.js`, change line 4 from:

```js
import { classifyWithCache } from './pipeline/cache-orchestrator.js';
```

to:

```js
import { classifyWithCache, sha256Hex } from './pipeline/cache-orchestrator.js';
```

- [ ] **Step 2: Replace the cache slot with a `Map`**

In `src/worker.js`, change line 24 from:

```js
let nerCache = null;
```

to:

```js
const nerCache = new Map();
```

(The cache is now mutated in place rather than reassigned.)

- [ ] **Step 3: Update the `classify` branch to look up by hash and write back into the map**

In `src/worker.js`, the current `classify` branch contains:

```js
const { ctx, cache: newCache } = await classifyWithCache({
  text: e.data.text,
  enabledEntities: currentConfig.enabledEntities,
  cache: nerCache,
  sources: SOURCES,
  entitySources: ENTITY_SOURCES,
  loadModel: loadModelForPipeline,
  getSentenceBoundaries: get_sentence_boundaries,
  sortSources,
});
nerCache = newCache;
```

Replace with:

```js
const hash = await sha256Hex(e.data.text);
const prev = nerCache.get(hash) ?? null;
const { ctx, cache: newEntry } = await classifyWithCache({
  text: e.data.text,
  enabledEntities: currentConfig.enabledEntities,
  cache: prev,
  sources: SOURCES,
  entitySources: ENTITY_SOURCES,
  loadModel: loadModelForPipeline,
  getSentenceBoundaries: get_sentence_boundaries,
  sortSources,
});
nerCache.set(hash, newEntry);
```

- [ ] **Step 4: Update the `configure` branch to clear the map instead of nullifying**

In `src/worker.js`, change line 193 from:

```js
nerCache = null;
```

to:

```js
nerCache.clear();
```

- [ ] **Step 5: Run all tests and confirm they pass**

```bash
npm test
```

Expected: all existing tests still pass. (No worker-level unit tests — coverage is via pipeline tests + manual eval.)

- [ ] **Step 6: Smoke test in the dev server**

```bash
npm run dev
```

Open the app, paste a short test document with one PII entity, click Anonimizuj, confirm the legend renders. Re-click Anonimizuj on the same text — should be near-instant (cache hit, postprocess only). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add src/worker.js
git commit -m "refactor(worker): switch NER cache from single slot to Map"
```

---

## Task 4: Worker classify echoes optional `id` on the result

Adds the wire-level support for routing per-source results back to main.js. Backwards-compatible: messages without `id` get a result without `id` (today's behavior).

**Files:**
- Modify: `src/worker.js`

- [ ] **Step 1: Plumb `id` through `classify` and the `result` postMessage**

In `src/worker.js`, the current `classify` branch starts with:

```js
if (type === 'classify') {
  if (!currentConfig) {
    self.postMessage({ type: 'error', message: 'Worker not configured' });
    return;
  }
```

Capture `id` near the top of the branch:

```js
if (type === 'classify') {
  const { id } = e.data;
  if (!currentConfig) {
    self.postMessage({ type: 'error', id, message: 'Worker not configured' });
    return;
  }
```

Update the empty-entities error similarly:

```js
if (currentConfig.enabledEntities.length === 0) {
  self.postMessage({ type: 'error', id, message: 'No entities enabled' });
  return;
}
```

Update the success postMessage from:

```js
self.postMessage({
  type: 'result',
  data: ctx.entities,
  anonymized: ctx.anonymized,
  legend: ctx.legend,
  debug: ctx.debug,
});
```

to:

```js
self.postMessage({
  type: 'result',
  id,
  data: ctx.entities,
  anonymized: ctx.anonymized,
  legend: ctx.legend,
  debug: ctx.debug,
});
```

And the catch block:

```js
} catch (err) {
  console.error('[worker] classify failed:', err);
  self.postMessage({ type: 'error', id, message: err.message });
}
```

(`anonymized` and `legend` in the result are now redundant for multi-doc — main.js will recompute them from the shared legend — but keeping them in the message preserves backwards-compatibility for any caller that doesn't supply `id` and relies on the existing fields.)

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: pass (no behavior change without `id`).

- [ ] **Step 3: Commit**

```bash
git add src/worker.js
git commit -m "feat(worker): echo optional classify id on result/error messages"
```

---

## Task 5: Sources-list module

A reusable component that renders a vertical list of source cards. Each card hosts an `AnnotationEditor` plus label + remove controls. The component is presentational: state lives in main.js, which calls `addSource`/`removeSource`/`setEntities`/etc. The component fires callbacks for user actions.

**Files:**
- Create: `src/ui/sources-list/index.js`
- Create: `src/ui/sources-list/styles.css`
- Create: `src/ui/sources-list/sources-list.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/sources-list/sources-list.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSourcesList } from './index.js';

describe('createSourcesList', () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
  });

  function defaultOpts(overrides = {}) {
    return {
      entityCategories: [],
      entityLabels: {},
      postEdit: (ctx) => ctx,
      onAddPaste: vi.fn(),
      onAddFiles: vi.fn(),
      onRemove: vi.fn(),
      onRename: vi.fn(),
      onAnnotationChange: vi.fn(),
      onModeChange: vi.fn(),
      ...overrides,
    };
  }

  it('renders an empty container with an "add" affordance', () => {
    createSourcesList(root, defaultOpts());
    expect(root.querySelector('[data-testid="sources-add-paste"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="sources-add-file"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid^="source-card-"]').length).toBe(0);
  });

  it('addSource creates a card with the given label', () => {
    const list = createSourcesList(root, defaultOpts());
    list.addSource('s1', 'umowa.docx', { text: '', entities: [] });
    const card = root.querySelector('[data-testid="source-card-s1"]');
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-testid="source-label-s1"]').textContent).toBe('umowa.docx');
  });

  it('removeSource detaches the card', () => {
    const list = createSourcesList(root, defaultOpts());
    list.addSource('s1', 'a', { text: '', entities: [] });
    list.removeSource('s1');
    expect(root.querySelector('[data-testid="source-card-s1"]')).toBeNull();
  });

  it('clicking the paste affordance fires onAddPaste', () => {
    const opts = defaultOpts();
    createSourcesList(root, opts);
    root.querySelector('[data-testid="sources-add-paste"]').click();
    expect(opts.onAddPaste).toHaveBeenCalledTimes(1);
  });

  it('selecting files via the file input fires onAddFiles', () => {
    const opts = defaultOpts();
    createSourcesList(root, opts);
    const input = root.querySelector('[data-testid="sources-add-file-input"]');
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(opts.onAddFiles).toHaveBeenCalledTimes(1);
    expect(opts.onAddFiles.mock.calls[0][0][0].name).toBe('a.txt');
  });

  it('clicking remove fires onRemove with id', () => {
    const opts = defaultOpts();
    const list = createSourcesList(root, opts);
    list.addSource('s1', 'a', { text: '', entities: [] });
    root.querySelector('[data-testid="source-remove-s1"]').click();
    expect(opts.onRemove).toHaveBeenCalledWith('s1');
  });

  it('renaming via the label input fires onRename and updates display', () => {
    const opts = defaultOpts();
    const list = createSourcesList(root, opts);
    list.addSource('s1', 'old', { text: '', entities: [] });
    const editBtn = root.querySelector('[data-testid="source-rename-s1"]');
    editBtn.click();
    const input = root.querySelector('[data-testid="source-label-input-s1"]');
    input.value = 'new';
    input.dispatchEvent(new Event('change'));
    input.dispatchEvent(new Event('blur'));
    expect(opts.onRename).toHaveBeenCalledWith('s1', 'new');
    list.setSourceLabel('s1', 'new');
    expect(root.querySelector('[data-testid="source-label-s1"]').textContent).toBe('new');
  });

  it('setSourceStatus updates a status indicator inside the card', () => {
    const list = createSourcesList(root, defaultOpts());
    list.addSource('s1', 'a', { text: '', entities: [] });
    list.setSourceStatus('s1', 'pending');
    expect(
      root.querySelector('[data-testid="source-status-s1"]').dataset.status,
    ).toBe('pending');
    list.setSourceStatus('s1', 'ready');
    expect(
      root.querySelector('[data-testid="source-status-s1"]').dataset.status,
    ).toBe('ready');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run src/ui/sources-list/sources-list.test.js
```

Expected: all eight tests fail with module-not-found.

- [ ] **Step 3: Create the styles file**

Create `src/ui/sources-list/styles.css` (minimal — UI redesign will replace this):

```css
.srclist {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.srclist-card {
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  padding: 0.75rem;
  background: #fff;
}
.srclist-card-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.srclist-label {
  font-weight: 600;
}
.srclist-label-input {
  font: inherit;
  padding: 0.1rem 0.25rem;
}
.srclist-status[data-status="pending"]::before { content: "⏳ "; }
.srclist-status[data-status="ready"]::before { content: "✓ "; }
.srclist-status[data-status="error"]::before { content: "⚠ "; color: #c33; }
.srclist-status[data-status="idle"]::before { content: ""; }
.srclist-spacer { flex: 1; }
.srclist-add {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.5rem;
}
```

- [ ] **Step 4: Implement the module**

Create `src/ui/sources-list/index.js`:

```js
import { createAnnotationEditor } from '../annotation-editor/index.js';

export function createSourcesList(rootEl, opts) {
  rootEl.classList.add('srclist');

  const cards = new Map(); // id -> { wrapper, editor, labelEl, statusEl }

  const cardsHost = document.createElement('div');
  rootEl.appendChild(cardsHost);

  const addRow = document.createElement('div');
  addRow.className = 'srclist-add';

  const pasteBtn = document.createElement('button');
  pasteBtn.type = 'button';
  pasteBtn.className = 'btn btn-secondary';
  pasteBtn.dataset.testid = 'sources-add-paste';
  pasteBtn.textContent = 'Wklej tekst';
  pasteBtn.addEventListener('click', () => opts.onAddPaste());
  addRow.appendChild(pasteBtn);

  const fileBtn = document.createElement('button');
  fileBtn.type = 'button';
  fileBtn.className = 'btn btn-secondary';
  fileBtn.dataset.testid = 'sources-add-file';
  fileBtn.textContent = 'Wgraj plik';
  addRow.appendChild(fileBtn);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.pdf,.docx,.txt,.png,.jpg,.jpeg,.heic,.heif';
  fileInput.style.display = 'none';
  fileInput.dataset.testid = 'sources-add-file-input';
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length > 0) opts.onAddFiles(files);
  });
  fileBtn.addEventListener('click', () => fileInput.click());
  addRow.appendChild(fileInput);

  rootEl.appendChild(addRow);

  function makeCard(id, label, init) {
    const wrapper = document.createElement('div');
    wrapper.className = 'srclist-card';
    wrapper.dataset.testid = `source-card-${id}`;

    const head = document.createElement('div');
    head.className = 'srclist-card-head';

    const labelEl = document.createElement('span');
    labelEl.className = 'srclist-label';
    labelEl.dataset.testid = `source-label-${id}`;
    labelEl.textContent = label;
    head.appendChild(labelEl);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn btn-secondary';
    renameBtn.dataset.testid = `source-rename-${id}`;
    renameBtn.textContent = 'Zmień nazwę';
    renameBtn.addEventListener('click', () => beginRename(id));
    head.appendChild(renameBtn);

    const statusEl = document.createElement('span');
    statusEl.className = 'srclist-status';
    statusEl.dataset.testid = `source-status-${id}`;
    statusEl.dataset.status = init.status ?? 'idle';
    head.appendChild(statusEl);

    const spacer = document.createElement('div');
    spacer.className = 'srclist-spacer';
    head.appendChild(spacer);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-secondary';
    removeBtn.dataset.testid = `source-remove-${id}`;
    removeBtn.textContent = 'Usuń';
    removeBtn.addEventListener('click', () => opts.onRemove(id));
    head.appendChild(removeBtn);

    wrapper.appendChild(head);

    const editorRoot = document.createElement('div');
    wrapper.appendChild(editorRoot);
    const editor = createAnnotationEditor(editorRoot, {
      text: init.text ?? '',
      entities: init.entities ?? [],
      entityCategories: opts.entityCategories ?? [],
      entityLabels: opts.entityLabels ?? {},
      postEdit: opts.postEdit,
      onChange: (entities) => opts.onAnnotationChange(id, entities),
      onModeChange: (mode) => opts.onModeChange(id, mode),
    });

    cardsHost.appendChild(wrapper);
    return { wrapper, editor, labelEl, statusEl };
  }

  function beginRename(id) {
    const card = cards.get(id);
    if (!card) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'srclist-label-input';
    input.dataset.testid = `source-label-input-${id}`;
    input.value = card.labelEl.textContent;
    let next = input.value;
    input.addEventListener('change', () => { next = input.value; });
    input.addEventListener('blur', () => {
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        finalize(card.labelEl.textContent);
        return;
      }
      finalize(trimmed);
      opts.onRename(id, trimmed);
    });
    function finalize(label) {
      card.labelEl.textContent = label;
      input.replaceWith(card.labelEl);
    }
    card.labelEl.replaceWith(input);
    input.focus();
    input.select();
  }

  return {
    addSource(id, label, init = {}) {
      if (cards.has(id)) throw new Error(`source ${id} already exists`);
      cards.set(id, makeCard(id, label, init));
    },
    removeSource(id) {
      const card = cards.get(id);
      if (!card) return;
      try { card.editor.dispose?.(); } catch {}
      card.wrapper.remove();
      cards.delete(id);
    },
    setSourceText(id, text) {
      cards.get(id)?.editor.setText(text);
    },
    setSourceEntities(id, entities) {
      cards.get(id)?.editor.setEntities(entities);
    },
    setSourceLabel(id, label) {
      const card = cards.get(id);
      if (card) card.labelEl.textContent = label;
    },
    setSourceStatus(id, status, error) {
      const card = cards.get(id);
      if (!card) return;
      card.statusEl.dataset.status = status;
      card.statusEl.textContent = status === 'error' ? (error ?? 'błąd') : '';
    },
    getText(id) { return cards.get(id)?.editor.getText() ?? ''; },
    getEntities(id) { return cards.get(id)?.editor.getEntities() ?? []; },
    getMode(id) { return cards.get(id)?.editor.getMode() ?? 'text'; },
    enterTextMode(id) { cards.get(id)?.editor.enterTextMode(); },
    commitTextMode(id, text) {
      const card = cards.get(id);
      return card ? card.editor.commitTextMode(text) : { changed: false };
    },
    listIds() { return [...cards.keys()]; },
    dispose() {
      for (const id of [...cards.keys()]) this.removeSource(id);
      rootEl.classList.remove('srclist');
      rootEl.innerHTML = '';
    },
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx vitest run src/ui/sources-list/sources-list.test.js
```

Expected: all eight tests pass.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/sources-list/
git commit -m "feat(ui): add sources-list module for multi-document workspace"
```

---

## Task 6: Outcomes-list module

Renders a list of LLM-produced outcomes. Each card displays the deanonymized text (recomputed on every render from token-text + legend) and a copy button. Read-only in v1 (write-only via MCP, per spec).

**Files:**
- Create: `src/ui/outcomes-list/index.js`
- Create: `src/ui/outcomes-list/styles.css`
- Create: `src/ui/outcomes-list/outcomes-list.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/outcomes-list/outcomes-list.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOutcomesList } from './index.js';

describe('createOutcomesList', () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root');
  });

  it('renders no cards initially', () => {
    createOutcomesList(root, { onRemove: vi.fn() });
    expect(root.querySelectorAll('[data-testid^="outcome-card-"]').length).toBe(0);
  });

  it('addOutcome renders a card with the deanonymized text', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'Pismo', '[PERSON_NAME_1] przyjmuje warunki.', {
      '[PERSON_NAME_1]': 'Jan Kowalski',
    });
    const body = root.querySelector('[data-testid="outcome-body-o1"]');
    expect(body.textContent).toBe('Jan Kowalski przyjmuje warunki.');
  });

  it('updateOutcome re-renders body and label', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'A', '[PERSON_NAME_1] tu.', { '[PERSON_NAME_1]': 'Jan' });
    list.updateOutcome('o1', 'B', '[PERSON_NAME_1] tam.', { '[PERSON_NAME_1]': 'Anna' });
    expect(
      root.querySelector('[data-testid="outcome-label-o1"]').textContent,
    ).toBe('B');
    expect(
      root.querySelector('[data-testid="outcome-body-o1"]').textContent,
    ).toBe('Anna tam.');
  });

  it('refreshLegend re-renders every card with the new legend', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'A', '[PERSON_NAME_1] tu.', { '[PERSON_NAME_1]': 'Jan' });
    list.addOutcome('o2', 'B', '[PERSON_NAME_1] tam.', { '[PERSON_NAME_1]': 'Jan' });
    list.refreshLegend({ '[PERSON_NAME_1]': 'Anna' });
    expect(root.querySelector('[data-testid="outcome-body-o1"]').textContent).toBe('Anna tu.');
    expect(root.querySelector('[data-testid="outcome-body-o2"]').textContent).toBe('Anna tam.');
  });

  it('removeOutcome detaches the card', () => {
    const list = createOutcomesList(root, { onRemove: vi.fn() });
    list.addOutcome('o1', 'A', 'x', {});
    list.removeOutcome('o1');
    expect(root.querySelector('[data-testid="outcome-card-o1"]')).toBeNull();
  });

  it('clicking remove fires onRemove(id)', () => {
    const onRemove = vi.fn();
    const list = createOutcomesList(root, { onRemove });
    list.addOutcome('o1', 'A', 'x', {});
    root.querySelector('[data-testid="outcome-remove-o1"]').click();
    expect(onRemove).toHaveBeenCalledWith('o1');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run src/ui/outcomes-list/outcomes-list.test.js
```

Expected: all six fail with module-not-found.

- [ ] **Step 3: Create the styles**

Create `src/ui/outcomes-list/styles.css`:

```css
.outlist {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.outlist-card {
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  padding: 0.75rem;
  background: #fff;
}
.outlist-card-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.outlist-label {
  font-weight: 600;
}
.outlist-spacer { flex: 1; }
.outlist-body {
  white-space: pre-wrap;
  font-family: inherit;
  margin: 0;
}
```

- [ ] **Step 4: Implement the module**

Create `src/ui/outcomes-list/index.js`:

```js
import { deanonymizeText } from '../../anonymizer.js';

export function createOutcomesList(rootEl, opts) {
  rootEl.classList.add('outlist');

  // id -> { wrapper, labelEl, bodyEl, copyBtn, tokenText: string }
  const cards = new Map();
  let currentLegend = {};

  function renderCard(id, label, tokenText, legend) {
    const card = cards.get(id);
    if (!card) return;
    card.labelEl.textContent = label;
    card.tokenText = tokenText;
    card.bodyEl.textContent = deanonymizeText(tokenText, legend);
  }

  return {
    addOutcome(id, label, tokenText, legend) {
      if (cards.has(id)) throw new Error(`outcome ${id} already exists`);
      currentLegend = legend;

      const wrapper = document.createElement('div');
      wrapper.className = 'outlist-card';
      wrapper.dataset.testid = `outcome-card-${id}`;

      const head = document.createElement('div');
      head.className = 'outlist-card-head';

      const labelEl = document.createElement('span');
      labelEl.className = 'outlist-label';
      labelEl.dataset.testid = `outcome-label-${id}`;
      head.appendChild(labelEl);

      const spacer = document.createElement('div');
      spacer.className = 'outlist-spacer';
      head.appendChild(spacer);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-secondary';
      copyBtn.dataset.testid = `outcome-copy-${id}`;
      copyBtn.textContent = 'Kopiuj';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(cards.get(id)?.bodyEl.textContent ?? '');
        copyBtn.textContent = 'Skopiowano!';
        setTimeout(() => { copyBtn.textContent = 'Kopiuj'; }, 2000);
      });
      head.appendChild(copyBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-secondary';
      removeBtn.dataset.testid = `outcome-remove-${id}`;
      removeBtn.textContent = 'Usuń';
      removeBtn.addEventListener('click', () => opts.onRemove(id));
      head.appendChild(removeBtn);

      wrapper.appendChild(head);

      const bodyEl = document.createElement('pre');
      bodyEl.className = 'outlist-body';
      bodyEl.dataset.testid = `outcome-body-${id}`;
      wrapper.appendChild(bodyEl);

      rootEl.appendChild(wrapper);
      cards.set(id, { wrapper, labelEl, bodyEl, copyBtn, tokenText: '' });
      renderCard(id, label, tokenText, legend);
    },
    updateOutcome(id, label, tokenText, legend) {
      currentLegend = legend;
      renderCard(id, label, tokenText, legend);
    },
    removeOutcome(id) {
      const card = cards.get(id);
      if (!card) return;
      card.wrapper.remove();
      cards.delete(id);
    },
    refreshLegend(legend) {
      currentLegend = legend;
      for (const [id, card] of cards) {
        card.bodyEl.textContent = deanonymizeText(card.tokenText, legend);
      }
    },
    listIds() { return [...cards.keys()]; },
    dispose() {
      cards.clear();
      rootEl.classList.remove('outlist');
      rootEl.innerHTML = '';
    },
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx vitest run src/ui/outcomes-list/outcomes-list.test.js
```

Expected: all six pass.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/outcomes-list/
git commit -m "feat(ui): add outcomes-list module for LLM-produced documents"
```

---

## Task 7: index.html — replace single-doc layout with multi-doc containers

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the input + result + deanonymize sections**

In `index.html`, the current sections from `<section id="input-section">` through `<section id="deanonymize-result-section" hidden>` are replaced. Find the block:

```html
    <section id="input-section">
      <label>2. Wklej swój dokument i anonimizuj</label>
      ...
    </section>

    <section id="result-section" hidden>
      <h3>Legenda</h3>
      ...
    </section>

    <section id="debug-section" hidden>
      <h3>Debug pipeline'u</h3>
      <div id="debug-panel"></div>
    </section>

    <section id="deanonymize-section" hidden>
      ...
    </section>

    <section id="deanonymize-result-section" hidden>
      ...
    </section>
```

Replace with:

```html
    <section id="run-section">
      <div class="run-actions">
        <button data-action="anonymize" class="btn btn-primary" disabled>Anonimizuj</button>
        <p data-status="model"></p>
      </div>
    </section>

    <section id="sources-section">
      <label>2. Dodaj dokumenty do anonimizacji</label>
      <div id="sources-list-root"></div>
    </section>

    <section id="result-section" hidden>
      <h3>Legenda</h3>
      <table id="legend-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Oryginalna wartość</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>

    <section id="debug-section" hidden>
      <h3>Debug pipeline'u</h3>
      <div id="debug-panel"></div>
    </section>

    <section id="outcomes-section" hidden>
      <h3>Wyniki LLM</h3>
      <div id="outcomes-list-root"></div>
    </section>
```

- [ ] **Step 2: Confirm the file parses by serving it**

```bash
npm run dev
```

The page will be broken (main.js still references the old DOM ids), but the HTML itself should parse without console errors from the markup. Stop the server.

- [ ] **Step 3: Don't commit yet**

This change leaves the app broken — the next task (main.js rewrite) finishes the migration. Commit them together to keep the history bisectable.

---

## Task 8: Rewrite `src/main.js` for multi-document state and dispatch

The largest task in the plan. Replaces `currentLegend`/`currentAnonymized`/`lastRun`/single-`editor` state with `sources[]`/`outcomes[]`/`legend`/per-source rerun tracking. Wires the sources-list and outcomes-list modules. Re-registers WebMCP tools (the five new tools; old two removed).

**Files:**
- Modify: `src/main.js` (substantial rewrite of the orchestration layer; entity-selector, debug panel, and WebNN-hint logic remain unchanged)
- Modify: `src/style.css` (import the two new module stylesheets)

- [ ] **Step 1: Add the module-stylesheet imports**

In `src/main.js`, near the existing CSS imports:

```js
import './style.css';
import './ui/annotation-editor/styles.css';
import './ui/workspace/styles.css';
```

Add:

```js
import './ui/sources-list/styles.css';
import './ui/outcomes-list/styles.css';
```

- [ ] **Step 2: Replace the state + DOM lookups + workspace creation**

Find the existing module-level state block (lines ~20-29):

```js
let currentLegend = null;
let currentAnonymized = '';
let configuredOnce = false;
let classifyInFlight = false;
let lastRun = null;
const urlParams = new URLSearchParams(window.location.search);
const isDebug = urlParams.get('debug') === '1';
const backendOverride = urlParams.get('backend');
const LS_KEY = 'pii.selected-entities';
```

Replace with:

```js
const sources = [];          // [{ id, label, text, entities, meta, status, error }]
const outcomes = [];         // [{ id, label, text }]   (text is in token form)
let legend = {};             // shared { token: original_value }
let seen = {};               // shared canonical-key -> token (for applyTokens)
let lastRun = null;          // { texts: Map<id, string>, enabledEntities: string[] }
const inFlightSourceIds = new Set();
let configuredOnce = false;
const urlParams = new URLSearchParams(window.location.search);
const isDebug = urlParams.get('debug') === '1';
const backendOverride = urlParams.get('backend');
const LS_KEY = 'pii.selected-entities';

function isAnyClassifyInFlight() { return inFlightSourceIds.size > 0; }
```

- [ ] **Step 3: Replace the DOM lookups**

Find the existing DOM lookup block (lines ~32-56):

```js
const anonymizeBtns = document.querySelectorAll('[data-action="anonymize"]');
const rerunBtns = document.querySelectorAll('[data-action="rerun"]');
const editTextBtns = document.querySelectorAll('[data-action="edit-text"]');
const copyAnonymizedBtns = document.querySelectorAll('[data-action="copy"]');
const modelStatusEls = document.querySelectorAll('[data-status="model"]');

function setHidden(els, hidden) { ... }
function setDisabled(els, disabled) { ... }
function setText(els, text) { ... }
const resultSection = document.getElementById('result-section');
const legendTableBody = document.querySelector('#legend-table tbody');
const debugSection = document.getElementById('debug-section');
const debugPanel = document.getElementById('debug-panel');
const deanonymizeSection = document.getElementById('deanonymize-section');
const deanonymizeInput = document.getElementById('deanonymize-input');
const deanonymizeBtn = document.getElementById('deanonymize-btn');
const deanonymizeResultSection = document.getElementById('deanonymize-result-section');
const deanonymizedOutput = document.getElementById('deanonymized-output');
const copyDeanonymizedBtn = document.getElementById('copy-deanonymized');
const selectorRoot = document.getElementById('entity-selector-root');
const workspaceRoot = document.getElementById('workspace-root');
```

Replace with:

```js
const anonymizeBtns = document.querySelectorAll('[data-action="anonymize"]');
const modelStatusEls = document.querySelectorAll('[data-status="model"]');

function setHidden(els, hidden) { els.forEach(el => { el.hidden = hidden; }); }
function setDisabled(els, disabled) { els.forEach(el => { el.disabled = disabled; }); }
function setText(els, text) { els.forEach(el => { el.textContent = text; }); }

const resultSection = document.getElementById('result-section');
const legendTableBody = document.querySelector('#legend-table tbody');
const debugSection = document.getElementById('debug-section');
const debugPanel = document.getElementById('debug-panel');
const outcomesSection = document.getElementById('outcomes-section');
const selectorRoot = document.getElementById('entity-selector-root');
const sourcesListRoot = document.getElementById('sources-list-root');
const outcomesListRoot = document.getElementById('outcomes-list-root');
```

The WebNN-hint block (lines ~53-99) is unchanged.

- [ ] **Step 4: Update imports**

Add to the imports at the top of `src/main.js`:

```js
import { deanonymizeText, anonymizeText, buildTokenMapMulti, applyTokens } from './anonymizer.js';
```

(Replaces the existing `deanonymizeText, anonymizeText` import.)

```js
import { createSourcesList } from './ui/sources-list/index.js';
import { createOutcomesList } from './ui/outcomes-list/index.js';
import { extractText } from './file-import/index.js';
```

(Add these. Keep the existing `entity-selector`, `workspace`, `pipeline/steps/backfill` imports; the workspace import becomes unused but leave it for now — Task 10 cleanup.)

- [ ] **Step 5: Replace the editor wiring**

Find the existing `const editor = createWorkspace(...)` block (lines ~148-171) and replace with the sources-list + outcomes-list wiring:

```js
const sourcesList = createSourcesList(sourcesListRoot, {
  entityCategories: ENTITY_CATEGORIES,
  entityLabels: ENTITY_LABELS,
  postEdit(text, entities) {
    return backfillOccurrencesStep({ text, entities }).entities;
  },
  onAddPaste() {
    const id = crypto.randomUUID();
    const label = nextPasteLabel();
    sources.push({
      id, label, text: '', entities: [], meta: null, status: 'idle', error: null,
    });
    sourcesList.addSource(id, label, { text: '', entities: [], status: 'idle' });
    sourcesList.enterTextMode(id);
    refreshAnonymizeButton();
  },
  async onAddFiles(files) {
    for (const file of files) await addSourceFromFile(file);
  },
  onRemove(id) {
    const idx = sources.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const removed = sources[idx];
    if (removed.status === 'ready' && removed.entities.length > 0) {
      const ok = window.confirm(`Usunąć "${removed.label}"?`);
      if (!ok) return;
    }
    sources.splice(idx, 1);
    sourcesList.removeSource(id);
    refreshLegend();
    refreshAnonymizeButton();
  },
  onRename(id, label) {
    const s = sources.find((x) => x.id === id);
    if (s) s.label = label;
  },
  onAnnotationChange(id, entities) {
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    s.entities = entities;
    refreshLegend();
  },
  onModeChange() { refreshAnonymizeButton(); },
});

const outcomesList = createOutcomesList(outcomesListRoot, {
  onRemove(id) {
    const idx = outcomes.findIndex((o) => o.id === id);
    if (idx === -1) return;
    outcomes.splice(idx, 1);
    outcomesList.removeOutcome(id);
    if (outcomes.length === 0) outcomesSection.hidden = true;
  },
});

function nextPasteLabel() {
  const used = sources
    .map((s) => /^Wklejony tekst (\d+)$/.exec(s.label)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return `Wklejony tekst ${next}`;
}

async function addSourceFromFile(file) {
  const id = crypto.randomUUID();
  const label = file.name || `Plik ${sources.length + 1}`;
  sources.push({
    id, label, text: '', entities: [], meta: null, status: 'pending', error: null,
  });
  sourcesList.addSource(id, label, { text: '', entities: [], status: 'pending' });
  try {
    const { text, meta } = await extractText(file);
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    s.text = text;
    s.meta = meta;
    s.status = 'idle';
    s.error = null;
    sourcesList.setSourceText(id, text);
    sourcesList.setSourceStatus(id, 'idle');
  } catch (err) {
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    s.status = 'error';
    s.error = err.message;
    sourcesList.setSourceStatus(id, 'error', err.message);
  }
  refreshAnonymizeButton();
}
```

- [ ] **Step 6: Replace `refreshLegendAndAnonymized` with `refreshLegend`**

Find the existing `refreshLegendAndAnonymized` (lines ~173-199) and replace with:

```js
function refreshLegend() {
  const ready = sources.filter((s) => s.status === 'ready' && s.entities.length > 0);
  if (ready.length === 0) {
    legend = {};
    seen = {};
    legendTableBody.innerHTML = '';
    resultSection.hidden = true;
    outcomesList.refreshLegend({});
    return;
  }
  const built = buildTokenMapMulti(
    ready.map((s) => ({ text: s.text, entities: s.entities })),
  );
  seen = built.seen;
  legend = built.legend;

  legendTableBody.innerHTML = '';
  for (const [token, value] of Object.entries(legend)) {
    const row = document.createElement('tr');
    const tokenCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = token;
    tokenCell.appendChild(code);
    const valueCell = document.createElement('td');
    valueCell.textContent = value;
    row.appendChild(tokenCell);
    row.appendChild(valueCell);
    legendTableBody.appendChild(row);
  }
  resultSection.hidden = false;
  outcomesList.refreshLegend(legend);
}

function anonymizedTextFor(sourceId) {
  const s = sources.find((x) => x.id === sourceId);
  if (!s || s.status !== 'ready') return null;
  return applyTokens(s.text, s.entities, seen);
}
```

- [ ] **Step 7: Replace `updateAnonymizeButton`/`updateRerunButton`**

Find both functions (lines ~201-233) and the helper `setsEqual` (just before). Replace with:

```js
function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function refreshAnonymizeButton() {
  const hasSelection = selector.getSelected().length > 0;
  const hasAnyText = sources.some((s) => (s.text ?? '').trim().length > 0);
  const blocked = !configuredOnce || isAnyClassifyInFlight();
  setDisabled(anonymizeBtns, blocked || !hasSelection || !hasAnyText);
  if (!hasSelection) setText(modelStatusEls, 'Wybierz przynajmniej jedną encję.');
  else if (!isAnyClassifyInFlight()) setText(modelStatusEls, '');
}
```

(There is no separate "rerun" button in the multi-doc UI — the global "Anonimizuj" button is always the entry point. Per-source staleness will be reintroduced in a future increment as part of the redesign; v1 keeps the behavior simple.)

- [ ] **Step 8: Replace the worker.onmessage handler**

Find the existing `worker.onmessage = (e) => {...}` (lines ~235-275) and replace with:

```js
worker.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'progress': {
      const pct = Math.round(msg.progress ?? 0);
      setText(modelStatusEls, `Pobieranie modelu ${msg.file ?? ''}... ${pct}%`);
      break;
    }
    case 'backend-resolved':
      console.log(`[main] WebNN ${msg.webnnAvailable ? 'available — fp32 models will run on GPU' : 'unavailable — all models on WASM'} (requested=${msg.requested})`);
      break;
    case 'configured':
      configuredOnce = true;
      refreshAnonymizeButton();
      break;
    case 'result': {
      console.log(`[bench-timing] result t=${performance.now().toFixed(2)}`);
      const id = msg.id;
      const s = sources.find((x) => x.id === id);
      if (s) {
        s.entities = msg.data;
        s.status = 'ready';
        s.error = null;
        sourcesList.setSourceEntities(id, msg.data);
        sourcesList.setSourceStatus(id, 'ready');
      }
      inFlightSourceIds.delete(id);
      refreshLegend();
      if (isDebug && msg.debug) {
        renderDebugPanel(msg.debug, msg.anonymized, msg.legend);
        debugSection.hidden = false;
      }
      if (!isAnyClassifyInFlight()) {
        const allEmpty = sources.every((x) => x.entities.length === 0);
        if (allEmpty) {
          setText(modelStatusEls, 'Nie znaleziono żadnych danych osobowych w tekście.');
        } else {
          setText(modelStatusEls, '');
        }
        lastRun = {
          texts: new Map(sources.map((x) => [x.id, x.text])),
          enabledEntities: [...selector.getSelected()].sort(),
        };
        setText(anonymizeBtns, 'Anonimizuj');
      } else {
        setText(modelStatusEls, `Analizowanie ${sources.length - inFlightSourceIds.size}/${sources.length}…`);
      }
      refreshAnonymizeButton();
      break;
    }
    case 'timing':
      console.log(`[bench-timing] ${msg.mark}${msg.alias ? ' alias=' + msg.alias : ''} t=${msg.t.toFixed(2)}`);
      break;
    case 'error': {
      const id = msg.id;
      const s = id ? sources.find((x) => x.id === id) : null;
      if (s) {
        s.status = 'error';
        s.error = msg.message;
        sourcesList.setSourceStatus(id, 'error', msg.message);
      }
      if (id) inFlightSourceIds.delete(id);
      if (!isAnyClassifyInFlight()) setText(anonymizeBtns, 'Anonimizuj');
      setText(modelStatusEls, `Błąd: ${msg.message}`);
      refreshAnonymizeButton();
      break;
    }
  }
};
```

- [ ] **Step 9: Replace the anonymize button handler**

Find the existing handlers for `anonymizeBtns`, `rerunBtns`, `editTextBtns`, `copyAnonymizedBtns`, `deanonymizeBtn`, `copyDeanonymizedBtn` (roughly lines ~277-313 and ~450-462) and replace with:

```js
anonymizeBtns.forEach(btn => btn.addEventListener('click', () => {
  // Commit any text-mode sources to flush pending edits into source.text.
  for (const s of sources) {
    if (sourcesList.getMode(s.id) === 'text') {
      const live = sourcesList.getText(s.id);
      sourcesList.commitTextMode(s.id, live);
      s.text = sourcesList.getText(s.id);
    }
  }
  const toClassify = sources.filter((s) => (s.text ?? '').trim().length > 0);
  if (toClassify.length === 0) return;

  for (const s of toClassify) {
    s.status = 'pending';
    s.error = null;
    sourcesList.setSourceStatus(s.id, 'pending');
    inFlightSourceIds.add(s.id);
  }
  setText(modelStatusEls, `Analizowanie 0/${toClassify.length}…`);
  setText(anonymizeBtns, 'Analizowanie...');
  refreshAnonymizeButton();
  for (const s of toClassify) {
    worker.postMessage({ type: 'classify', id: s.id, text: s.text });
  }
}));
```

(v1 simplification: every source with content is re-classified on each Anonimizuj click. The NER cache in the worker makes this cheap for unchanged sources — postprocess-only on cache hit.)

- [ ] **Step 10: Replace the WebMCP tool registrations**

Find the existing two `mcp.registerTool` calls at the end of `src/main.js` (lines ~467-512) and replace with the five new tools:

```js
const mcp = new WebMCP({ channelName: 'pii_anonymizer' });

function jsonContent(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
function textContent(value) {
  return { content: [{ type: 'text', text: value }] };
}

mcp.registerTool(
  'list_sources',
  'List all anonymized source documents that are ready. Returns id, label, and char_count for each. Text contents are token-form (PII never crosses this boundary).',
  { type: 'object', properties: {} },
  () => {
    const ready = sources.filter((s) => s.status === 'ready');
    const items = ready.map((s) => {
      const anonymized = applyTokens(s.text, s.entities, seen);
      return { id: s.id, label: s.label, char_count: anonymized.length };
    });
    return jsonContent(items);
  },
);

mcp.registerTool(
  'read_source',
  'Read the anonymized (token-form) text of a single source by id. PII is never returned.',
  {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  ({ id }) => {
    const s = sources.find((x) => x.id === id);
    if (!s || s.status !== 'ready') return jsonContent({ error: `Source ${id} not ready` });
    return textContent(applyTokens(s.text, s.entities, seen));
  },
);

mcp.registerTool(
  'list_outcomes',
  'List all outcome documents (LLM-produced, in token form). Returns id, label, char_count.',
  { type: 'object', properties: {} },
  () => jsonContent(outcomes.map((o) => ({ id: o.id, label: o.label, char_count: o.text.length }))),
);

mcp.registerTool(
  'read_outcome',
  'Read the tokenized text of an outcome by id (the LLM\'s own previous output).',
  {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  ({ id }) => {
    const o = outcomes.find((x) => x.id === id);
    if (!o) return jsonContent({ error: `Outcome ${id} not found` });
    return textContent(o.text);
  },
);

mcp.registerTool(
  'write_outcome',
  'Create or update an outcome document. Provide id to update an existing outcome; omit id to create a new one. text MUST be in token form (e.g. [PERSON_NAME_1]); the browser deanonymizes it for the human user only and never returns PII.',
  {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      text: { type: 'string' },
    },
    required: ['label', 'text'],
  },
  ({ id, label, text }) => {
    if (typeof label !== 'string' || label.trim().length === 0) {
      return jsonContent({ error: 'label must be a non-empty string' });
    }
    if (typeof text !== 'string') {
      return jsonContent({ error: 'text must be a string' });
    }
    if (id) {
      const o = outcomes.find((x) => x.id === id);
      if (!o) return jsonContent({ error: `Outcome ${id} not found` });
      o.label = label;
      o.text = text;
      outcomesList.updateOutcome(id, label, text, legend);
      outcomesSection.hidden = false;
      return jsonContent({ id, success: true });
    }
    const newId = crypto.randomUUID();
    outcomes.push({ id: newId, label, text });
    outcomesList.addOutcome(newId, label, text, legend);
    outcomesSection.hidden = false;
    return jsonContent({ id: newId, success: true });
  },
);
```

- [ ] **Step 11: Initial-state wiring at the bottom**

The existing `updateAnonymizeButton(); updateRerunButton();` calls (lines ~464-465) become:

```js
refreshAnonymizeButton();
```

- [ ] **Step 12: Run the full test suite**

```bash
npm test
```

Expected: all unit tests pass. (No new tests for main.js orchestration — covered manually in Task 9.)

- [ ] **Step 13: Smoke-test in the dev server**

```bash
npm run dev
```

Manual checks:
1. Page loads without console errors.
2. Click "Wklej tekst" → a card appears in text mode. Type "Jan Kowalski podpisał umowę." into it.
3. Click "Wklej tekst" again → second card appears. Type "Anna Nowak pełnomocnikiem Jana Kowalskiego."
4. Click "Anonimizuj" (top-level button). Status flips to "Analizowanie 0/2…", then both cards reach "✓ ready".
5. Legend table shows shared tokens — `[PERSON_NAME_1]: Jan Kowalski` (only one!) and `[PERSON_NAME_2]: Anna Nowak`. *This is the central correctness check.*
6. Click "Usuń" on the second card → confirm dialog → legend updates (Anna's token disappears).
7. Stop the server.

If any of those fail, fix in this task before moving on.

- [ ] **Step 14: Commit Task 7 + 8 together**

```bash
git add index.html src/main.js
git commit -m "feat: multi-document anonymization with shared legend"
```

(Task 7's HTML change was deliberately uncommitted — they ship together.)

---

## Task 9: Verification — eval baseline + WebMCP smoke test

The data-layer change to `buildTokenMapMulti`/`applyTokens` should not affect single-document evaluation results. Run a tagged eval to confirm. Then exercise the new WebMCP tools end-to-end.

**Files:** none (verification only)

- [ ] **Step 1: Run a tagged eval baseline**

```bash
npm run eval -- --label=multi-doc-baseline
```

This downloads models if needed (slow first time) and processes every `test-data/synthetic/*.txt` document.

- [ ] **Step 2: Score the run**

```bash
npm run eval:score
```

Expected: aggregate F1 within ±0.005 of the previous main-branch run. Any meaningful drop means `applyTokens` extraction or `buildTokenMapMulti` inadvertently changed single-doc behavior — investigate before continuing.

- [ ] **Step 3: Compare to a pre-multi-doc run if one exists**

```bash
npm run eval:list
npm run eval:compare multi-doc-baseline <previous-run-label>
```

Document any diffs in the commit body for Task 10. Identical or numerically equivalent diffs are expected.

- [ ] **Step 4: WebMCP smoke test**

Steps:
1. Start the dev server: `npm run dev`.
2. Configure the WebMCP client per `CLAUDE.md` ("WebMCP Integration > Setup").
3. In the browser, add two source documents (paste or upload), click Anonimizuj.
4. In the LLM client, generate a WebMCP token, paste it into the in-page widget.
5. Ask the LLM: "Use list_sources to show me the available documents, then read_source on each to get their text."
6. Confirm: `list_sources` returns two items with the right labels and char counts.
7. Confirm: `read_source` returns tokenized text — it should contain `[PERSON_NAME_*]` etc., never raw PII.
8. Ask the LLM: "Use write_outcome to create a one-paragraph summary of these documents, keeping the tokens intact." Confirm a new outcome card appears in the browser, deanonymized for display.
9. Ask the LLM: "Now use list_outcomes and read_outcome to read your own summary back." Confirm the read returns the tokenized form (not the deanonymized one).
10. Ask the LLM to update its summary via `write_outcome` with the same id. Confirm the card updates in place.
11. Stop the server.

- [ ] **Step 5: Commit any verification artifacts**

If `eval:score` produces a useful summary worth keeping, no separate commit needed — eval results live under `test-data/results/` which is git-ignored. If you spotted issues that needed fixes, those would be separate commits in the relevant tasks above.

---

## Task 10: Mark `createWorkspace` as deprecated for the main path

`src/ui/workspace/index.js` is no longer used by `src/main.js` after Task 8. Decide whether to delete or document.

**Files:**
- Modify (optional): `src/ui/workspace/index.js`

- [ ] **Step 1: Verify nothing in `src/` imports the workspace module anymore**

```bash
grep -rn "ui/workspace" src/
```

Expected output: only the file itself (`src/ui/workspace/index.js`) and its test (`src/ui/workspace/workspace.test.js`). If any other file still imports it, that's an oversight in Task 8 — go fix it.

- [ ] **Step 2: Choose: delete or keep**

The user's call. Two reasonable options:

- **Delete** the workspace module. Frees ~430 LOC + tests. The single-source dropzone + file-pill + OCR-progress UI is gone, but those affordances will be designed fresh in the upcoming UI redesign anyway.
- **Keep** it. Costs nothing at runtime (not imported on the main path) and might be useful as a reference for the redesign. Add a top-of-file comment `// Unused on the main path; retained for reference during the multi-doc UI redesign.` to flag the status.

Default: **keep** with the comment, since the cleanup can be done freely in a follow-up and the redesign may benefit from referencing it.

- [ ] **Step 3: If deleting, remove and confirm tests pass**

If you chose to delete:

```bash
rm -rf src/ui/workspace
npm test
git add -A
git commit -m "chore(ui): remove unused createWorkspace module"
```

If keeping, add the comment in `src/ui/workspace/index.js` near the top:

```js
// Unused on the main path after multi-document support landed.
// Retained for reference during the upcoming UI redesign.
export function createWorkspace(rootEl, options) {
```

Then:

```bash
git add src/ui/workspace/index.js
git commit -m "chore(ui): mark createWorkspace as unused on the main path"
```

---

## Self-review notes

Coverage check against the spec:

- ✅ Multi-source data model — Task 8 step 2.
- ✅ Outcome data model — Task 8 step 2 + 10.
- ✅ `buildTokenMapMulti` cross-source legend — Tasks 1, 2.
- ✅ Token rebuild triggers (classify result, annotation edit, source removal) — Task 8 steps 5, 8.
- ✅ Worker cache `null` → `Map` — Task 3.
- ✅ Worker classify echoes `id` — Task 4.
- ✅ Five new MCP tools, two old removed — Task 8 step 10.
- ✅ Sources list UI scaffolding — Tasks 5, 7, 8.
- ✅ Outcomes list UI scaffolding — Tasks 6, 7, 8.
- ✅ Insertion-order numbering rule — Task 2 test "numbers tokens in insertion order".
- ✅ Polish declension carries cross-source — Task 2 test.
- ✅ Eval verification — Task 9.
- ✅ MCP smoke verification — Task 9.

One spec item explicitly **descoped** here vs the spec text:
- **"Anonimizuj ponownie" per source / staleness highlights** — the spec describes per-source staleness; the implementation in Task 8 step 7 keeps a single global Anonimizuj that always runs every staged source. Documented in that step. This simplifies the v1 UI and matches the spec's "minimal stopgap" framing. The redesign can reintroduce per-source rerun affordances.
