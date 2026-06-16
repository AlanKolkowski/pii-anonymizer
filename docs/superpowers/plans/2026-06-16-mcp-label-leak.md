# MCP Label Leak Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop raw document labels (upload filenames, user-private names) from crossing the WebMCP boundary, by emitting a synthetic-or-user-shared `mcpLabel` from `list_sources`/`list_outcomes` instead of the private `label`.

**Architecture:** Split each source/outcome into a private browser-only `label` and an assistant-visible `mcpLabel`. `mcpLabel` defaults to a stable synthetic name (`Źródło N` / `Wynik N`); the MCP boundary emits only `mcpLabel`. A new pure module `src/mcp/listings.js` builds the boundary payloads so they are unit-testable. A UI control lets the user opt into a custom assistant-visible name, clearly marked as visible to the assistant.

**Tech Stack:** Vanilla ESM, Vite, Vitest (`globals` enabled but tests import explicitly), jsdom for UI tests. No TypeScript, no linter.

**Spec:** `docs/superpowers/specs/2026-06-16-mcp-label-leak-fix-design.md`

**Scope note:** This touches `src/mcp/`, `src/main.js`, `src/ui/`, and docs — **not** `src/pipeline`. The `CLAUDE.md` rule "run eval after modifying src/pipeline" does **not** apply; do not run `npm run eval`.

---

## File Structure

- **Create** `src/mcp/listings.js` — pure functions `buildSourceListing(sources, seen)`, `buildOutcomeListing(outcomes)`, and the synthetic-label factory `createLabelSequence(prefix)`. The single source of truth for what label crosses the boundary.
- **Create** `src/mcp/listings.test.js` — unit tests for the above (the security-critical assertions).
- **Modify** `src/main.js` — add `mcpLabel` at source creation (paste + file), wire the two `list_*` handlers to the new builders, thread `mcpLabel` through the outcome create/update paths, add the `onMcpLabelChange` callback, update tool description strings.
- **Modify** `src/ui/outcomes-coordinator.js` — store/maintain `mcpLabel` on outcomes.
- **Modify** `src/ui/outcomes-coordinator.test.js` — cover the new `mcpLabel` behavior.
- **Modify** `src/ui/sources-list/index.js` — store `card.mcpLabel`, render an assistant-visible alias control, add `beginMcpRename`.
- **Modify** `src/ui/sources-list/sources-list.test.js` — cover the alias control.
- **Modify** `docs/webmcp.md`, `CLAUDE.md` — reconcile the privacy guarantee wording.

---

## Task 1: MCP listing module (pure, testable boundary)

**Files:**
- Create: `src/mcp/listings.js`
- Test: `src/mcp/listings.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/mcp/listings.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildSourceListing, buildOutcomeListing, createLabelSequence } from './listings.js';

describe('buildSourceListing', () => {
  const seen = { 'PERSON_NAME::Jan Kowalski': '[PERSON_NAME_1]' };

  function readySource(overrides = {}) {
    return {
      id: 's1',
      label: 'Jan_Kowalski_pozew.pdf',
      mcpLabel: 'Źródło 1',
      text: 'Pozew Jan Kowalski.',
      entities: [{ entity_group: 'PERSON_NAME', start: 6, end: 18, score: 0.99 }],
      status: 'ready',
      ...overrides,
    };
  }

  it('emits the synthetic mcpLabel and never the private filename', () => {
    const listing = buildSourceListing([readySource()], seen);
    expect(listing).toEqual([
      { id: 's1', label: 'Źródło 1', char_count: 'Pozew [PERSON_NAME_1].'.length },
    ]);
    expect(JSON.stringify(listing)).not.toContain('Kowalski');
    expect(JSON.stringify(listing)).not.toContain('.pdf');
  });

  it('emits a user-shared mcpLabel verbatim', () => {
    const listing = buildSourceListing([readySource({ mcpLabel: 'Sprawa rozwodowa' })], seen);
    expect(listing[0].label).toBe('Sprawa rozwodowa');
  });

  it('excludes sources that are not ready', () => {
    const listing = buildSourceListing(
      [readySource(), readySource({ id: 's2', status: 'pending' })],
      seen,
    );
    expect(listing.map((x) => x.id)).toEqual(['s1']);
  });
});

describe('buildOutcomeListing', () => {
  it('emits mcpLabel and never the private label', () => {
    const outcomes = [
      { id: 'o1', label: 'Moja prywatna notatka', mcpLabel: 'Wynik 1', text: 'Witaj [PERSON_NAME_1].' },
    ];
    const listing = buildOutcomeListing(outcomes);
    expect(listing).toEqual([
      { id: 'o1', label: 'Wynik 1', char_count: 'Witaj [PERSON_NAME_1].'.length },
    ]);
    expect(JSON.stringify(listing)).not.toContain('prywatna');
  });
});

describe('createLabelSequence', () => {
  it('produces stable, monotonically increasing labels', () => {
    const next = createLabelSequence('Źródło');
    expect([next(), next(), next()]).toEqual(['Źródło 1', 'Źródło 2', 'Źródło 3']);
  });

  it('keeps independent sequences independent', () => {
    const sources = createLabelSequence('Źródło');
    const outcomes = createLabelSequence('Wynik');
    expect(sources()).toBe('Źródło 1');
    expect(outcomes()).toBe('Wynik 1');
    expect(sources()).toBe('Źródło 2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/mcp/listings.test.js`
Expected: FAIL — `Failed to resolve import "./listings.js"` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/mcp/listings.js`:

```js
import { applyTokens } from '../anonymizer.js';

// Payload for the `list_sources` MCP tool. Only `mcpLabel` (a synthetic or
// user-shared name) crosses the boundary — never the private `label`, which may
// be a raw upload filename. `char_count` is derived from the tokenized text so
// it never reflects raw PII length.
export function buildSourceListing(sources, seen) {
  return sources
    .filter((s) => s.status === 'ready')
    .map((s) => ({
      id: s.id,
      label: s.mcpLabel,
      char_count: applyTokens(s.text, s.entities, seen).length,
    }));
}

// Payload for the `list_outcomes` MCP tool. Emits the assistant-visible
// `mcpLabel`; outcome `text` is already token-only.
export function buildOutcomeListing(outcomes) {
  return outcomes.map((o) => ({
    id: o.id,
    label: o.mcpLabel,
    char_count: o.text.length,
  }));
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/mcp/listings.test.js`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/listings.js src/mcp/listings.test.js
git commit -m "$(cat <<'EOF'
feat(mcp): add label-safe listing builders for the MCP boundary

buildSourceListing / buildOutcomeListing emit only the assistant-visible
mcpLabel; createLabelSequence assigns stable synthetic labels.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Sources carry a synthetic `mcpLabel`; `list_sources` emits it

**Files:**
- Modify: `src/main.js` (import; sequencers; paste push `~365`; file push `~498`; `list_sources` handler `~1541`)

This closes the source-side leak. The two source-creation sites in `main.js` aren't unit-testable in isolation (importing `main.js` boots the whole app), so verification here is the passing Task 1 suite plus a production build and a diff read. The behavior is exercised end-to-end via the manual smoke test in Task 6's verification.

- [ ] **Step 1: Add the listings import**

Find (`src/main.js:1`):

```js
import { buildTokenMapMulti, applyTokens } from './anonymizer.js';
```

Add immediately below it:

```js
import { buildSourceListing, buildOutcomeListing, createLabelSequence } from './mcp/listings.js';
```

- [ ] **Step 2: Add the synthetic-label sequencers**

Find (`src/main.js:38`):

```js
let seen = {};
```

Add immediately below it:

```js
const nextSourceMcpLabel = createLabelSequence('Źródło');
const nextOutcomeMcpLabel = createLabelSequence('Wynik');
```

- [ ] **Step 3: Set `mcpLabel` on paste-created sources**

Find (inside `onAddPaste`, `src/main.js:365-372`):

```js
    const id = crypto.randomUUID();
    const label = nextPasteLabel();
    sources.push({
      id, label, text: '', entities: [], meta: null, status: 'idle', error: null, lastReadyText: null,
    });
    sourcesList.addSource(id, label, {
      text: '', entities: [], status: 'idle', type: 'paste',
    });
```

Replace with:

```js
    const id = crypto.randomUUID();
    const label = nextPasteLabel();
    const mcpLabel = nextSourceMcpLabel();
    sources.push({
      id, label, mcpLabel, text: '', entities: [], meta: null, status: 'idle', error: null, lastReadyText: null,
    });
    sourcesList.addSource(id, label, {
      text: '', entities: [], status: 'idle', type: 'paste', mcpLabel,
    });
```

- [ ] **Step 4: Set `mcpLabel` on file-created sources**

Find (inside `addSourceFromFile`, `src/main.js:498-505`):

```js
  const id = crypto.randomUUID();
  const label = file.name || `Plik ${sources.length + 1}`;
  sources.push({
    id, label, text: '', entities: [], meta: null, status: 'pending', error: null, lastReadyText: null,
  });
  sourcesList.addSource(id, label, {
    text: '', entities: [], status: 'pending', type: 'file',
  });
```

Replace with:

```js
  const id = crypto.randomUUID();
  const label = file.name || `Plik ${sources.length + 1}`;
  const mcpLabel = nextSourceMcpLabel();
  sources.push({
    id, label, mcpLabel, text: '', entities: [], meta: null, status: 'pending', error: null, lastReadyText: null,
  });
  sourcesList.addSource(id, label, {
    text: '', entities: [], status: 'pending', type: 'file', mcpLabel,
  });
```

- [ ] **Step 5: Emit `mcpLabel` from `list_sources`**

Find (`src/main.js:1541-1548`):

```js
  () => {
    const ready = sources.filter((s) => s.status === 'ready');
    const items = ready.map((s) => {
      const anonymized = applyTokens(s.text, s.entities, seen);
      return { id: s.id, label: s.label, char_count: anonymized.length };
    });
    return jsonContent(items);
  },
```

Replace with:

```js
  () => jsonContent(buildSourceListing(sources, seen)),
```

- [ ] **Step 6: Verify the build and the diff**

Run: `npm run build`
Expected: build succeeds, no errors.

Run: `git diff -- src/main.js`
Expected: confirm `list_sources` now returns `buildSourceListing(sources, seen)`, both `sources.push` sites include `mcpLabel`, and `applyTokens` is still imported (it remains used elsewhere in `main.js`).

Run: `npx vitest run src/mcp/listings.test.js`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "$(cat <<'EOF'
fix(mcp): stop list_sources leaking raw filenames (#13)

Sources now carry a synthetic mcpLabel assigned at creation; list_sources
emits mcpLabel via buildSourceListing instead of the private filename label.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Outcomes carry `mcpLabel`; `list_outcomes` emits it

**Files:**
- Modify: `src/ui/outcomes-coordinator.js` (`createOutcome` `~19`, `updateOutcomeFields` `~27`)
- Test: `src/ui/outcomes-coordinator.test.js`
- Modify: `src/main.js` (wrappers `~459`/`~466`; deanon `onAdd` `~428`; `write_outcome` `~1607-1613`; `list_outcomes` handler `~1570`)

Rule: `mcpLabel` is **LLM-authored** (set on every `write_outcome`) or **synthetic** (UI-created). A user *display* rename never changes `mcpLabel`.

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the `describe('createOutcomesCoordinator', ...)` in `src/ui/outcomes-coordinator.test.js` (after the existing tests):

```js
  it('tracks mcpLabel: synthetic or LLM-authored, unaffected by display renames', () => {
    document.body.innerHTML = '<div id="deanon"></div>';
    const outcomes = [];
    const deanon = createDeanonWorkspace(document.getElementById('deanon'), {
      getOutcomes: () => outcomes,
      getLegend: () => ({}),
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onRemove: vi.fn(),
      entityLabels: {},
    });
    deanon.render();
    let n = 0;
    const coordinator = createOutcomesCoordinator({
      outcomes,
      deanonWorkspace: deanon,
      getLegend: () => ({}),
      makeId: () => `o-${(n += 1)}`,
    });

    // LLM-authored: caller passes mcpLabel = supplied label.
    const llmId = coordinator.createOutcome('Pozew [PERSON_NAME_1]', 'Treść.', 'Pozew [PERSON_NAME_1]');
    expect(outcomes.find((o) => o.id === llmId).mcpLabel).toBe('Pozew [PERSON_NAME_1]');

    // UI-created: synthetic mcpLabel, private label kept separate.
    const uiId = coordinator.createOutcome('Moja prywatna nazwa', 'Tekst.', 'Wynik 7');
    expect(outcomes.find((o) => o.id === uiId).mcpLabel).toBe('Wynik 7');

    // User display-rename (no mcpLabel option) must NOT change mcpLabel.
    coordinator.updateOutcomeFields(uiId, 'Inna prywatna nazwa', 'Tekst.');
    const afterRename = outcomes.find((o) => o.id === uiId);
    expect(afterRename.label).toBe('Inna prywatna nazwa');
    expect(afterRename.mcpLabel).toBe('Wynik 7');

    // LLM write (with mcpLabel option) updates mcpLabel.
    coordinator.updateOutcomeFields(uiId, 'Z LLM', 'Tekst 2.', { mcpLabel: 'Z LLM' });
    expect(outcomes.find((o) => o.id === uiId).mcpLabel).toBe('Z LLM');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/outcomes-coordinator.test.js`
Expected: FAIL — `mcpLabel` is `undefined` (the coordinator does not set it yet).

- [ ] **Step 3: Update `createOutcome` in the coordinator**

Find (`src/ui/outcomes-coordinator.js:19-25`):

```js
  function createOutcome(label, text) {
    const id = makeId();
    outcomes.push({ id, label, text });
    outcomesList.addOutcome(id, label, text, currentLegend());
    deanonWorkspace.activateOutcome(id);
    return id;
  }
```

Replace with:

```js
  function createOutcome(label, text, mcpLabel = label) {
    const id = makeId();
    outcomes.push({ id, label, mcpLabel, text });
    outcomesList.addOutcome(id, label, text, currentLegend());
    deanonWorkspace.activateOutcome(id);
    return id;
  }
```

- [ ] **Step 4: Update `updateOutcomeFields` in the coordinator**

Find (`src/ui/outcomes-coordinator.js:27-35`):

```js
  function updateOutcomeFields(id, label, text) {
    const outcome = outcomes.find((x) => x.id === id);
    if (!outcome) return false;
    outcome.label = label;
    outcome.text = text;
    outcomesList.updateOutcome(id, label, text, currentLegend());
    deanonWorkspace.activateOutcome(id);
    return true;
  }
```

Replace with:

```js
  function updateOutcomeFields(id, label, text, { mcpLabel } = {}) {
    const outcome = outcomes.find((x) => x.id === id);
    if (!outcome) return false;
    outcome.label = label;
    outcome.text = text;
    if (mcpLabel !== undefined) outcome.mcpLabel = mcpLabel;
    outcomesList.updateOutcome(id, label, text, currentLegend());
    deanonWorkspace.activateOutcome(id);
    return true;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/ui/outcomes-coordinator.test.js`
Expected: PASS (existing tests + the new one).

- [ ] **Step 6: Thread `mcpLabel` through the `main.js` wrappers**

Find (`src/main.js:459-461`):

```js
function createOutcome(label, text) {
  return outcomeCoordinator.createOutcome(label, text);
}
```

Replace with:

```js
function createOutcome(label, text, mcpLabel) {
  return outcomeCoordinator.createOutcome(label, text, mcpLabel);
}
```

Find (`src/main.js:466-468`):

```js
function updateOutcomeFields(id, label, text) {
  return outcomeCoordinator.updateOutcomeFields(id, label, text);
}
```

Replace with:

```js
function updateOutcomeFields(id, label, text, opts) {
  return outcomeCoordinator.updateOutcomeFields(id, label, text, opts);
}
```

- [ ] **Step 7: Give UI-created outcomes a synthetic `mcpLabel`**

Find (inside the `deanonWorkspace` opts, `src/main.js:428-430`):

```js
  onAdd(label, text) {
    createOutcome(label, text);
  },
```

Replace with:

```js
  onAdd(label, text) {
    createOutcome(label, text, nextOutcomeMcpLabel());
  },
```

(Leave the `onUpdate(id, label, text)` handler at `~431` unchanged — a UI rename must not pass `mcpLabel`, so the outcome's assistant-visible name stays put.)

- [ ] **Step 8: Make `write_outcome` set `mcpLabel` to the LLM-authored label**

Find (`src/main.js:1607-1613`):

```js
    if (id) {
      if (!updateOutcomeFields(id, label, text)) {
        return jsonContent({ error: `Dokument wynikowy ${id} nie istnieje` });
      }
      return jsonContent({ id, success: true });
    }
    const newId = createOutcome(label, text);
    return jsonContent({ id: newId, success: true });
```

Replace with:

```js
    if (id) {
      if (!updateOutcomeFields(id, label, text, { mcpLabel: label })) {
        return jsonContent({ error: `Dokument wynikowy ${id} nie istnieje` });
      }
      return jsonContent({ id, success: true });
    }
    const newId = createOutcome(label, text, label);
    return jsonContent({ id: newId, success: true });
```

- [ ] **Step 9: Emit `mcpLabel` from `list_outcomes`**

Find (`src/main.js:1570`):

```js
  () => jsonContent(outcomes.map((o) => ({ id: o.id, label: o.label, char_count: o.text.length }))),
```

Replace with:

```js
  () => jsonContent(buildOutcomeListing(outcomes)),
```

- [ ] **Step 10: Verify build + full coordinator suite**

Run: `npm run build`
Expected: succeeds.

Run: `npx vitest run src/ui/outcomes-coordinator.test.js src/mcp/listings.test.js`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/main.js src/ui/outcomes-coordinator.js src/ui/outcomes-coordinator.test.js
git commit -m "$(cat <<'EOF'
fix(mcp): stop list_outcomes leaking private outcome labels (#13)

Outcomes carry an mcpLabel that is LLM-authored (set on every write_outcome)
or synthetic (UI-created). User display renames no longer touch mcpLabel.
list_outcomes emits mcpLabel via buildOutcomeListing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Reconcile the documented privacy guarantee

**Files:**
- Modify: `src/main.js` (`list_sources` description `~1539`; `list_outcomes` description `~1568`)
- Modify: `docs/webmcp.md` (`:3`)
- Modify: `CLAUDE.md` (`:90`)

No test — documentation only. Verify by reading the diff.

- [ ] **Step 1: Update the `list_sources` tool description**

Find (`src/main.js:1539`):

```js
  'Wypisz gotowe zanonimizowane dokumenty źródłowe. Zwraca id, label i char_count dla każdego dokumentu. Treść jest tokenizowana — PII nigdy nie opuszcza przeglądarki.',
```

Replace with:

```js
  'Wypisz gotowe zanonimizowane dokumenty źródłowe. Zwraca id, label i char_count dla każdego dokumentu. label to nazwa syntetyczna (np. „Źródło 1") albo nazwa jawnie udostępniona przez użytkownika — nigdy surowa nazwa pliku. Treść jest tokenizowana; PII nigdy nie opuszcza przeglądarki.',
```

- [ ] **Step 2: Update the `list_outcomes` tool description**

Find (`src/main.js:1568`):

```js
  'Wypisz dokumenty wynikowe utworzone przez LLM w formie tokenów. Zwraca id, label i char_count.',
```

Replace with:

```js
  'Wypisz dokumenty wynikowe w formie tokenów. Zwraca id, label i char_count. label to nazwa syntetyczna (np. „Wynik 1") albo nazwa nadana przez asystenta — nigdy prywatna nazwa użytkownika.',
```

- [ ] **Step 3: Update `docs/webmcp.md`**

Find (`docs/webmcp.md:3`):

```
pii.tools udostępnia dokumenty agentowi przez WebMCP bez wysyłania jawnych danych osobowych do LLM. Przez MCP przechodzą wyłącznie teksty w formie tokenów, np. `[PERSON_NAME_1]`. Legenda oraz deanonimizacja zostają w przeglądarce użytkownika.
```

Replace with:

```
pii.tools udostępnia dokumenty agentowi przez WebMCP bez wysyłania jawnych danych osobowych do LLM. Przez MCP przechodzą wyłącznie teksty w formie tokenów, np. `[PERSON_NAME_1]`, oraz nazwy dokumentów (`label`), które są syntetyczne (np. „Źródło 1") albo jawnie udostępnione przez użytkownika — nigdy surowe nazwy plików. Legenda oraz deanonimizacja zostają w przeglądarce użytkownika.
```

- [ ] **Step 4: Update `CLAUDE.md`**

Find (`CLAUDE.md:90`):

```
The app integrates with [WebMCP](https://webmcp.dev/) to expose a source/outcome workflow for LLM clients. All WebMCP traffic is tokenized text; PII never crosses the MCP boundary and deanonymization happens only in the browser UI. Full user/agent setup docs live in `docs/webmcp.md`.
```

Replace with:

```
The app integrates with [WebMCP](https://webmcp.dev/) to expose a source/outcome workflow for LLM clients. Document bodies cross the boundary only as tokenized text; document labels cross only as synthetic names (`Źródło N` / `Wynik N`) or names the user explicitly chose to share — never raw filenames. Deanonymization happens only in the browser UI. Full user/agent setup docs live in `docs/webmcp.md`.
```

- [ ] **Step 5: Verify and commit**

Run: `git diff -- src/main.js docs/webmcp.md CLAUDE.md`
Expected: the four strings above are updated and nothing else.

```bash
git add src/main.js docs/webmcp.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(mcp): reconcile privacy guarantee with synthetic labels (#13)

Tool descriptions and docs now state that labels crossing the boundary are
synthetic or user-shared, never raw filenames.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Assistant-visible alias control (user opt-in)

**Files:**
- Modify: `src/ui/sources-list/index.js` (`refreshToolbar` `~325`; `addSource` `~540`; add `beginMcpRename`)
- Test: `src/ui/sources-list/sources-list.test.js`
- Modify: `src/main.js` (add `onMcpLabelChange` to the `createSourcesList` opts `~400`)

Lets the user set a custom assistant-visible name, clearly marked as visible to the assistant. Empty input cancels the edit (keeps the current `mcpLabel`).

- [ ] **Step 1: Write the failing test**

Add this `describe` block inside the top-level `describe('createSourcesList', ...)` in `src/ui/sources-list/sources-list.test.js` (use the existing `defaultOpts` helper):

```js
  describe('assistant-visible label', () => {
    it('shows the mcpLabel in the toolbar and edits it through onMcpLabelChange', () => {
      const opts = defaultOpts({ onMcpLabelChange: vi.fn() });
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'Jan_Kowalski_pozew.pdf', {
        text: 'tekst', entities: [], status: 'idle', type: 'file', mcpLabel: 'Źródło 1',
      });

      const tag = toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]');
      expect(tag).not.toBeNull();
      expect(tag.textContent).toContain('Źródło 1');

      tag.click();
      const input = toolbarHost.querySelector('[data-testid="source-mcp-label-input-s1"]');
      expect(input).not.toBeNull();
      input.value = 'Sprawa rozwodowa';
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));

      expect(opts.onMcpLabelChange).toHaveBeenCalledWith('s1', 'Sprawa rozwodowa');
      expect(
        toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]').textContent,
      ).toContain('Sprawa rozwodowa');
    });

    it('an empty edit keeps the current mcpLabel and does not fire the callback', () => {
      const opts = defaultOpts({ onMcpLabelChange: vi.fn() });
      const list = createSourcesList(root, opts);
      list.addSource('s1', 'plik.pdf', {
        text: 't', entities: [], status: 'idle', type: 'file', mcpLabel: 'Źródło 1',
      });

      toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]').click();
      const input = toolbarHost.querySelector('[data-testid="source-mcp-label-input-s1"]');
      input.value = '   ';
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));

      expect(opts.onMcpLabelChange).not.toHaveBeenCalled();
      expect(
        toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]').textContent,
      ).toContain('Źródło 1');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/sources-list/sources-list.test.js`
Expected: FAIL — `[data-testid="editor-toolbar-mcp-label"]` is `null` (control not rendered yet).

- [ ] **Step 3: Store `mcpLabel` on the card**

Find (`src/ui/sources-list/index.js:550`):

```js
      cards.set(id, { ...card, tabRefs, label, status, type });
```

Replace with:

```js
      cards.set(id, { ...card, tabRefs, label, mcpLabel: init.mcpLabel ?? label, status, type });
```

- [ ] **Step 4: Render the assistant-visible alias control in the toolbar**

Find (`src/ui/sources-list/index.js:334-338`):

```js
    const labelEl = document.createElement('span');
    labelEl.className = 'meta';
    labelEl.dataset.testid = 'editor-toolbar-label';
    labelEl.textContent = card.label;
    left.appendChild(labelEl);
```

Replace with:

```js
    const labelEl = document.createElement('span');
    labelEl.className = 'meta';
    labelEl.dataset.testid = 'editor-toolbar-label';
    labelEl.textContent = card.label;
    left.appendChild(labelEl);

    const mcpLabelEl = document.createElement('span');
    mcpLabelEl.className = 'meta srclist-mcp-label';
    mcpLabelEl.dataset.testid = 'editor-toolbar-mcp-label';
    mcpLabelEl.title = 'Nazwa widoczna dla asystenta (wysyłana przez MCP). Kliknij, aby zmienić.';
    mcpLabelEl.setAttribute('role', 'button');
    mcpLabelEl.tabIndex = 0;
    mcpLabelEl.textContent = `Asystent widzi: ${card.mcpLabel}`;
    const openMcpRename = () => beginMcpRename(activeId);
    mcpLabelEl.addEventListener('click', openMcpRename);
    mcpLabelEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openMcpRename();
    });
    left.appendChild(sep());
    left.appendChild(mcpLabelEl);
```

- [ ] **Step 5: Add the `beginMcpRename` function**

Find the end of the existing `beginRename` function (`src/ui/sources-list/index.js:440`):

```js
    labelEl.replaceWith(input);
    input.focus();
    input.select();
  }
```

Add immediately below it (a new function — this is the *first* `labelEl.replaceWith(input)` closing the `beginRename` body; add after that closing brace):

```js
  function beginMcpRename(id) {
    const card = cards.get(id);
    if (!card || id !== activeId) return;
    const el = toolbarHost.querySelector('[data-testid="editor-toolbar-mcp-label"]');
    if (!el) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'srclist-label-input';
    input.dataset.testid = `source-mcp-label-input-${id}`;
    input.title = 'Ta nazwa jest wysyłana do asystenta przez MCP.';
    input.value = card.mcpLabel;
    let next = input.value;
    input.addEventListener('change', () => { next = input.value; });
    input.addEventListener('blur', () => {
      const trimmed = next.trim();
      input.replaceWith(el);
      if (trimmed.length === 0 || trimmed === card.mcpLabel) {
        el.textContent = `Asystent widzi: ${card.mcpLabel}`;
        return;
      }
      card.mcpLabel = trimmed;
      el.textContent = `Asystent widzi: ${trimmed}`;
      opts.onMcpLabelChange?.(id, trimmed);
    });
    el.replaceWith(input);
    input.focus();
    input.select();
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/ui/sources-list/sources-list.test.js`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 7: Wire `onMcpLabelChange` in `main.js`**

Find (inside the `createSourcesList` opts, `src/main.js:400-403`):

```js
  onRename(id, label) {
    const s = sources.find((x) => x.id === id);
    if (s) s.label = label;
  },
```

Replace with:

```js
  onRename(id, label) {
    const s = sources.find((x) => x.id === id);
    if (s) s.label = label;
  },
  onMcpLabelChange(id, mcpLabel) {
    const s = sources.find((x) => x.id === id);
    if (s) s.mcpLabel = mcpLabel;
  },
```

- [ ] **Step 8: Verify the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/ui/sources-list/index.js src/ui/sources-list/sources-list.test.js src/main.js
git commit -m "$(cat <<'EOF'
feat(ui): let users set an assistant-visible source label (#13)

Adds a toolbar control to edit the mcpLabel, clearly marked as visible to
the assistant; main.js persists it onto the source so list_sources emits it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass, including `src/mcp/listings.test.js`, `src/ui/outcomes-coordinator.test.js`, `src/ui/sources-list/sources-list.test.js`.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Manual smoke test (MCP boundary)**

Following `docs/webmcp.md`:
1. `npm run dev`, open the app.
2. Upload a file named e.g. `Jan_Kowalski_pozew.pdf`, click **Anonimizuj**, wait for `ready`.
3. Generate a WebMCP token in your MCP client, connect via the widget.
4. Call `list_sources`.

Expected: the returned `label` is `Źródło 1` (not `Jan_Kowalski_pozew.pdf`). In the browser UI, the card still shows the real filename, and the toolbar shows `Asystent widzi: Źródło 1`. Editing that to a custom value and calling `list_sources` again returns the custom value.

- [ ] **Step 4: Finalize the branch**

Use the superpowers:finishing-a-development-branch skill to open a PR for `fix/13-mcp-label-leak` referencing issue #13, or merge per the user's preference.

---

## Self-Review

**Spec coverage:**
- §1 data-model split (`label` private, `mcpLabel` assistant-visible) → Tasks 2, 3, 5. ✅
- §2 handlers emit `mcpLabel`, field name stays `label`, `write_outcome` seeds both → Tasks 2, 3. ✅
- §3 stable monotonic synthetic counter → Task 1 (`createLabelSequence`) + Task 2/3 sequencers. ✅
- §4 assistant-visible alias control with explicit "visible to assistant" copy → Task 5. ✅
- §5 docs + tool descriptions reconciled → Task 4. ✅
- §6 testability refactor (pure listing functions) + tests → Task 1 + tests in Tasks 3, 5. ✅
- Sub-decision (a) outcome echo / user-rename keeps `mcpLabel` → Task 3 Step 1 test + Step 7. ✅
- Sub-decision (b) field name `mcpLabel` → used throughout. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✅

**Type/name consistency:** `mcpLabel` (field), `buildSourceListing(sources, seen)`, `buildOutcomeListing(outcomes)`, `createLabelSequence(prefix)`, `nextSourceMcpLabel`, `nextOutcomeMcpLabel`, `onMcpLabelChange(id, mcpLabel)`, `beginMcpRename(id)`, testids `editor-toolbar-mcp-label` / `source-mcp-label-input-<id>` — consistent across all tasks. ✅

**Note on non-unit-tested code:** the two `main.js` source-creation sites and the MCP handler wiring are verified via the pure-function suites (Task 1/3), `npm run build`, diff review, and the Task 6 manual smoke test — `main.js` boots the whole app on import and is not unit-testable in isolation.
