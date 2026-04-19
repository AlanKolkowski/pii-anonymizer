# Per-Entity Rules Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate scattered per-entity-type logic into a single `entity-rules.js` config, and add confidence-threshold + declarative blocklist steps.

**Architecture:** Create `src/pipeline/configs/entity-rules.js` with a `DEFAULT_RULE` baseline and one entry per declared entity type, exposed via `rulesFor(type)`. Each postprocess step imports `rulesFor` directly (no DI). Steps are small, single-purpose, and composable. New pipeline order: `sourceFilter → threshold → snap → trimTrailingDot → blocklist → maxLength → dedup → backfill → merge → tokenize`.

**Tech Stack:** Vanilla ESM JavaScript, Vitest (`globals: true`), no TypeScript.

**Spec:** `docs/superpowers/specs/2026-04-19-entity-rules-config-design.md`

---

## Task 0: Baseline eval run

**Purpose:** Capture current pipeline output so we can diff against it after implementation. Run before any code change.

**Files:** none

- [ ] **Step 0.1: Run baseline eval**

Run:
```bash
npm run eval -- --label=pre-entity-rules
```
Expected: completes, prints a result path under `test-data/results/<timestamp>/`, and `test-data/results/latest` points at it.

- [ ] **Step 0.2: Record the label**

Confirm with:
```bash
npm run eval:list
```
Expected: `pre-entity-rules` appears in the list. No commit (eval results are artifacts, not source).

---

## Task 1: Create `entity-rules.js` config

**Files:**
- Create: `src/pipeline/configs/entity-rules.js`
- Create: `src/pipeline/configs/entity-rules.test.js`

- [ ] **Step 1.1: Write the failing test**

Create `src/pipeline/configs/entity-rules.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { rulesFor, ENTITY_RULES, DEFAULT_RULE } from './entity-rules.js';

describe('rulesFor', () => {
  it('returns DEFAULT_RULE for unknown types', () => {
    const rules = rulesFor('NOT_A_REAL_TYPE');
    expect(rules).toEqual(DEFAULT_RULE);
  });

  it('merges entity overrides onto DEFAULT_RULE', () => {
    const rules = rulesFor('PERSON_ROLE_OR_TITLE');
    expect(rules.threshold).toBe(0.6);
    expect(rules.thresholdBySource['polish-q8']).toBe(0.75);
    expect(rules.blocklist).toEqual(['Pan', 'Pani', 'Nadawca']);
    expect(rules.snap).toBe(true); // from DEFAULT_RULE
    expect(rules.trimTrailingDot).toBe(true);
  });

  it('preserves DEFAULT_RULE.maxLength = null for unconfigured types', () => {
    expect(rulesFor('EMAIL_ADDRESS').maxLength).toBeNull();
  });

  it('returns a fresh object (callers may not mutate defaults)', () => {
    const a = rulesFor('PERSON_NAME');
    a.maxLength = 999;
    const b = rulesFor('PERSON_NAME');
    expect(b.maxLength).toBe(50);
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/pipeline/configs/entity-rules.test.js
```
Expected: FAIL with "Cannot find module './entity-rules.js'" or similar.

- [ ] **Step 1.3: Create the config module**

Create `src/pipeline/configs/entity-rules.js`:

```js
export const DEFAULT_RULE = {
  threshold: 0,
  thresholdBySource: {},
  maxLength: null,
  snap: true,
  trimTrailingDot: true,
  backfill: true,
  blocklist: [],
  mergeWithAdjacent: [],
};

export const ENTITY_RULES = {
  PERSON_NAME:              { maxLength: 50, threshold: 0.5 },
  PERSON_ROLE_OR_TITLE:     {
    maxLength: 70,
    threshold: 0.6,
    thresholdBySource: { 'polish-q8': 0.75 },
    blocklist: ['Pan', 'Pani', 'Nadawca'],
  },
  ORGANIZATION_NAME:        { maxLength: 120 },
  VEHICLE_IDENTIFIER:       { maxLength: 40 },
  LOCATION:                 { maxLength: 100 },
  POSTAL_ADDRESS:           { maxLength: 100, mergeWithAdjacent: ['LOCATION'] },
  PERSON_ATTRIBUTE:         { maxLength: 80 },
};

export function rulesFor(type) {
  return { ...DEFAULT_RULE, ...(ENTITY_RULES[type] || {}) };
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/pipeline/configs/entity-rules.test.js
```
Expected: all 4 tests pass.

- [ ] **Step 1.5: Run the full suite to confirm no breakage**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add src/pipeline/configs/entity-rules.js src/pipeline/configs/entity-rules.test.js
git commit -m "feat(config): add entity-rules config with rulesFor lookup

Central per-entity config declaring thresholds, maxLength, step
toggles, blocklist, and mergeWithAdjacent. Undeclared types fall
back to DEFAULT_RULE, preserving today's behavior."
```

---

## Task 2: Implement `thresholdStep`

**Files:**
- Create: `src/pipeline/steps/threshold.js`
- Create: `src/pipeline/steps/threshold.test.js`

- [ ] **Step 2.1: Write the failing tests**

Create `src/pipeline/steps/threshold.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { thresholdStep } from './threshold.js';

function ctx(entities) {
  return { text: '', segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { threshold: 0.5, thresholdBySource: {} },
      PERSON_ROLE_OR_TITLE: { threshold: 0.6, thresholdBySource: { 'polish-q8': 0.75 } },
    };
    return map[type] || { threshold: 0, thresholdBySource: {} };
  },
}));

describe('thresholdStep', () => {
  it('drops entities with score below per-type threshold', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.49, source: 'multilang-q8' },
      { entity_group: 'PERSON_NAME', start: 6, end: 10, score: 0.51, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].score).toBe(0.51);
  });

  it('accepts score equal to threshold (>=)', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.5, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('applies per-source threshold when entity.source matches', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.7, source: 'polish-q8' },
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 6, end: 10, score: 0.7, source: 'multilang-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].source).toBe('multilang-q8');
  });

  it('falls back to per-type threshold for sources not in thresholdBySource', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.59, source: 'regex' },
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 6, end: 10, score: 0.6, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].score).toBe(0.6);
  });

  it('falls back to per-type threshold when entity.source is an array', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 5, score: 0.6, source: ['polish-q8', 'multilang-q8'] },
    ]));
    expect(result.entities).toHaveLength(1);
  });

  it('keeps everything for types with default threshold 0', () => {
    const result = thresholdStep(ctx([
      { entity_group: 'EMAIL_ADDRESS', start: 0, end: 5, score: 0.01, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/pipeline/steps/threshold.test.js
```
Expected: FAIL with "Cannot find module './threshold.js'".

- [ ] **Step 2.3: Implement the step**

Create `src/pipeline/steps/threshold.js`:

```js
import { rulesFor } from '../configs/entity-rules.js';

export function thresholdStep(ctx) {
  const filtered = ctx.entities.filter((e) => {
    const rules = rulesFor(e.entity_group);
    const sourceThreshold =
      typeof e.source === 'string' ? rules.thresholdBySource[e.source] : undefined;
    const threshold = sourceThreshold ?? rules.threshold;
    return e.score >= threshold;
  });
  return { ...ctx, entities: filtered };
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/pipeline/steps/threshold.test.js
```
Expected: all 6 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/pipeline/steps/threshold.js src/pipeline/steps/threshold.test.js
git commit -m "feat(pipeline): add thresholdStep filtering by per-entity score

Applies per-(entity, source) confidence threshold from entity-rules.
Per-source overrides beat per-type default; array-valued source falls
back to per-type default."
```

---

## Task 3: Implement `blocklistStep`

**Files:**
- Create: `src/pipeline/steps/blocklist.js`
- Create: `src/pipeline/steps/blocklist.test.js`

- [ ] **Step 3.1: Write the failing tests**

Create `src/pipeline/steps/blocklist.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { blocklistStep } from './blocklist.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_ROLE_OR_TITLE: { blocklist: ['Pan', 'Pani', 'Nadawca'] },
    };
    return map[type] || { blocklist: [] };
  },
}));

describe('blocklistStep', () => {
  it('drops standalone exact match', () => {
    const text = 'Pan mieszka tu.';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 3, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('drops standalone match regardless of case', () => {
    const text = 'pan mieszka tu.';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 3, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('trims leading blocklisted word followed by whitespace', () => {
    const text = 'Pan Kowalski';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(4);
    expect(result.entities[0].end).toBe(12);
  });

  it('trims trailing blocklisted word preceded by whitespace', () => {
    const text = 'Kowalski Pan';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(8);
  });

  it('iteratively trims multiple blocklisted words at the edge', () => {
    const text = 'Pan Pani Kowalski';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 17, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(9);
    expect(result.entities[0].end).toBe(17);
  });

  it('drops entity when trimming consumes the whole span', () => {
    const text = 'Pan Pani';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 8, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('does not touch entities whose type has an empty blocklist', () => {
    const text = 'Pan Kowalski';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 0, end: 12, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(12);
  });

  it('does not trim when blocklisted token is not at an edge', () => {
    const text = 'Kowalski Pan Nowak';
    const result = blocklistStep(ctx(text, [
      { entity_group: 'PERSON_ROLE_OR_TITLE', start: 0, end: 18, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(18);
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/pipeline/steps/blocklist.test.js
```
Expected: FAIL with "Cannot find module './blocklist.js'".

- [ ] **Step 3.3: Implement the step**

Create `src/pipeline/steps/blocklist.js`:

```js
import { rulesFor } from '../configs/entity-rules.js';

const LEADING_WS = /^\s+/;
const TRAILING_WS = /\s+$/;

function dropsStandalone(slice, blocklistLower) {
  return blocklistLower.includes(slice.trim().toLowerCase());
}

function trimEdges(text, start, end, blocklistLower) {
  let curStart = start;
  let curEnd = end;
  let changed = true;
  while (changed && curStart < curEnd) {
    changed = false;
    const slice = text.slice(curStart, curEnd);

    // Trim leading blocklisted word + whitespace
    for (const blocked of blocklistLower) {
      if (slice.length <= blocked.length) continue;
      if (slice.slice(0, blocked.length).toLowerCase() !== blocked) continue;
      const after = slice.slice(blocked.length);
      const wsMatch = after.match(LEADING_WS);
      if (!wsMatch) continue;
      curStart += blocked.length + wsMatch[0].length;
      changed = true;
      break;
    }
    if (changed) continue;

    // Trim trailing whitespace + blocklisted word
    for (const blocked of blocklistLower) {
      if (curEnd - curStart <= blocked.length) continue;
      const tail = text.slice(curStart, curEnd);
      if (tail.slice(-blocked.length).toLowerCase() !== blocked) continue;
      const before = tail.slice(0, -blocked.length);
      const wsMatch = before.match(TRAILING_WS);
      if (!wsMatch) continue;
      curEnd -= blocked.length + wsMatch[0].length;
      changed = true;
      break;
    }
  }
  return { start: curStart, end: curEnd };
}

export function blocklistStep(ctx) {
  const { text, entities } = ctx;
  const out = [];
  for (const entity of entities) {
    const rules = rulesFor(entity.entity_group);
    if (!rules.blocklist || rules.blocklist.length === 0) {
      out.push(entity);
      continue;
    }
    const blocklistLower = rules.blocklist.map((s) => s.toLowerCase());
    const slice = text.slice(entity.start, entity.end);
    if (dropsStandalone(slice, blocklistLower)) continue;

    const { start, end } = trimEdges(text, entity.start, entity.end, blocklistLower);
    if (end <= start) continue;
    const trimmedSlice = text.slice(start, end).trim();
    if (!trimmedSlice) continue;
    if (dropsStandalone(text.slice(start, end), blocklistLower)) continue;

    if (start === entity.start && end === entity.end) {
      out.push(entity);
    } else {
      out.push({ ...entity, start, end });
    }
  }
  return { ...ctx, entities: out };
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/pipeline/steps/blocklist.test.js
```
Expected: all 8 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/pipeline/steps/blocklist.js src/pipeline/steps/blocklist.test.js
git commit -m "feat(pipeline): add blocklistStep for per-entity value filtering

Drops standalone blocklist matches and iteratively trims blocklisted
words at entity edges. Case-insensitive. Empty blocklists are no-ops."
```

---

## Task 4: Replace `filterStep` with `maxLengthStep`

**Files:**
- Create: `src/pipeline/steps/max-length.js`
- Create: `src/pipeline/steps/max-length.test.js`
- Delete: `src/pipeline/steps/filter.js`
- Modify: `src/anonymizer.js` (delete `MAX_ENTITY_LENGTH` and `filterOversizedEntities`)
- Modify: `src/pipeline/configs/default.js` (swap `filterStep` → `maxLengthStep`)

- [ ] **Step 4.1: Write the failing tests**

Create `src/pipeline/steps/max-length.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { maxLengthStep } from './max-length.js';

function ctx(entities) {
  return { text: '', segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { maxLength: 50 },
      LOCATION: { maxLength: 100 },
    };
    return map[type] || { maxLength: null };
  },
}));

describe('maxLengthStep', () => {
  it('drops entities exceeding maxLength', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 60, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('keeps entities at or below maxLength', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 50, score: 0.9, source: 'polish-q8' },
      { entity_group: 'PERSON_NAME', start: 60, end: 70, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('keeps all entities when type has no maxLength', () => {
    const result = maxLengthStep(ctx([
      { entity_group: 'EMAIL_ADDRESS', start: 0, end: 5000, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/pipeline/steps/max-length.test.js
```
Expected: FAIL with "Cannot find module './max-length.js'".

- [ ] **Step 4.3: Create the new step**

Create `src/pipeline/steps/max-length.js`:

```js
import { rulesFor } from '../configs/entity-rules.js';

export function maxLengthStep(ctx) {
  const filtered = ctx.entities.filter((e) => {
    const max = rulesFor(e.entity_group).maxLength;
    if (max == null) return true;
    return (e.end - e.start) <= max;
  });
  return { ...ctx, entities: filtered };
}
```

- [ ] **Step 4.4: Run the new test to verify it passes**

Run:
```bash
npx vitest run src/pipeline/steps/max-length.test.js
```
Expected: all 3 tests pass.

- [ ] **Step 4.5: Delete old filter step**

Delete the file `src/pipeline/steps/filter.js` entirely:
```bash
rm src/pipeline/steps/filter.js
```

- [ ] **Step 4.6: Remove `MAX_ENTITY_LENGTH` and `filterOversizedEntities` from `src/anonymizer.js`**

In `src/anonymizer.js`, delete lines 233-251 (the `// Max entity length per type — filters hallucinated oversized entities` comment block, `MAX_ENTITY_LENGTH` const, and `filterOversizedEntities` function). Leave everything else untouched.

- [ ] **Step 4.7: Update `src/pipeline/configs/default.js`**

In `src/pipeline/configs/default.js`:
- Change the import line from `import { filterStep } from '../steps/filter.js';` to `import { maxLengthStep } from '../steps/max-length.js';`.
- In the postprocess `steps` array, replace `filterStep` with `maxLengthStep` (position unchanged for now — will be reordered in Task 9).

- [ ] **Step 4.8: Run the full test suite**

Run:
```bash
npm test
```
Expected: all tests pass. Any test still importing `filterOversizedEntities` from `anonymizer.js` will fail — if so, inspect the failure and fix callers. There should be none; `filter.js` was the only caller.

- [ ] **Step 4.9: Commit**

```bash
git add -A
git commit -m "refactor(pipeline): replace filterStep with config-driven maxLengthStep

Moves MAX_ENTITY_LENGTH map out of anonymizer.js into entity-rules
config. Behavior unchanged — same per-type caps, same unconfigured
types uncapped. Debug step name changes from filterStep to maxLengthStep."
```

---

## Task 5: Gate `snapStep` on `rules.snap`

**Files:**
- Modify: `src/pipeline/steps/snap.js`
- Create: `src/pipeline/steps/snap.test.js`

- [ ] **Step 5.1: Write the failing tests**

Create `src/pipeline/steps/snap.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { snapStep } from './snap.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { snap: true },
      FINANCIAL_AMOUNT: { snap: false },
    };
    return map[type] || { snap: true };
  },
}));

describe('snapStep', () => {
  it('snaps entities of types with snap=true to word boundaries', () => {
    const text = 'Kowalski mieszka tu.';
    const result = snapStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 2, end: 6, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(8);
  });

  it('leaves entities with snap=false untouched', () => {
    const text = '1000 zł';
    const result = snapStep(ctx(text, [
      { entity_group: 'FINANCIAL_AMOUNT', start: 1, end: 3, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities[0].start).toBe(1);
    expect(result.entities[0].end).toBe(3);
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/pipeline/steps/snap.test.js
```
Expected: second test FAILS because current `snapStep` always snaps.

- [ ] **Step 5.3: Modify `src/pipeline/steps/snap.js`**

Replace the contents of `src/pipeline/steps/snap.js` with:

```js
import { snapToWordBoundaries } from '../../anonymizer.js';
import { rulesFor } from '../configs/entity-rules.js';

export function snapStep(ctx) {
  const snapCandidates = [];
  const passthrough = [];
  for (const e of ctx.entities) {
    if (rulesFor(e.entity_group).snap) snapCandidates.push(e);
    else passthrough.push(e);
  }
  const snapped = snapToWordBoundaries(snapCandidates, ctx.text);
  return { ...ctx, entities: [...snapped, ...passthrough] };
}
```

- [ ] **Step 5.4: Run the tests to verify they pass**

Run:
```bash
npx vitest run src/pipeline/steps/snap.test.js
```
Expected: both tests pass.

- [ ] **Step 5.5: Run the full suite**

Run:
```bash
npm test
```
Expected: all tests pass (nothing currently in `ENTITY_RULES` has `snap: false`, so behavior is unchanged for real runs).

- [ ] **Step 5.6: Commit**

```bash
git add src/pipeline/steps/snap.js src/pipeline/steps/snap.test.js
git commit -m "refactor(snap): gate snapStep on rules.snap

Snap now skips entities whose rule sets snap=false. Default is true,
so current behavior is preserved for all configured types."
```

---

## Task 6: Gate `trimTrailingDotStep` on `rules.trimTrailingDot`

**Files:**
- Modify: `src/pipeline/steps/trim-trailing-dot.js`
- Modify: `src/pipeline/steps/trim-trailing-dot.test.js`

- [ ] **Step 6.1: Read the current step and test**

Read `src/pipeline/steps/trim-trailing-dot.js` and `src/pipeline/steps/trim-trailing-dot.test.js` to understand the existing structure. The step currently trims trailing periods from entities at segment boundaries, respecting an abbreviation allowlist.

- [ ] **Step 6.2: Add a failing test for the new behavior**

Append to `src/pipeline/steps/trim-trailing-dot.test.js` (inside the existing `describe` block, before its closing `});`):

```js
  it('leaves entities untouched when rules.trimTrailingDot is false', async () => {
    vi.resetModules();
    vi.doMock('../configs/entity-rules.js', () => ({
      rulesFor: () => ({ trimTrailingDot: false }),
    }));
    const { trimTrailingDotStep: gatedStep } = await import('./trim-trailing-dot.js');

    const text = 'Pozdrawia Jan Kowalski.';
    const result = gatedStep(makeCtx({
      text,
      segments: [{ text, offset: 0 }],
      entities: [
        { entity_group: 'PERSON_NAME', start: 10, end: 23, score: 0.9, word: 'Jan Kowalski.' },
      ],
    }));
    expect(result.entities[0].end).toBe(23);
    expect(result.entities[0].word).toBe('Jan Kowalski.');
    vi.doUnmock('../configs/entity-rules.js');
  });
```

Also add `import { vi } from 'vitest';` at the top if not already present (current imports: `import { describe, it, expect } from 'vitest';`).

- [ ] **Step 6.3: Run the test to verify it fails**

Run:
```bash
npx vitest run src/pipeline/steps/trim-trailing-dot.test.js
```
Expected: the new test FAILS (step ignores rules.trimTrailingDot).

- [ ] **Step 6.4: Modify `src/pipeline/steps/trim-trailing-dot.js`**

At the top of the file, add:
```js
import { rulesFor } from '../configs/entity-rules.js';
```

Then, inside the `trimmed = entities.map(...)` callback, add as the FIRST line:
```js
    if (!rulesFor(entity.entity_group).trimTrailingDot) return entity;
```

The full modified callback (replacing the existing one starting at line 27):
```js
  const trimmed = entities.map((entity) => {
    if (!rulesFor(entity.entity_group).trimTrailingDot) return entity;
    if (text[entity.end - 1] !== '.') return entity;
    const seg = findContainingSegment(segments, entity.end);
    if (!seg) return entity;
    const segEnd = seg.offset + seg.text.length;
    const after = text.slice(entity.end, segEnd);
    if (!TRAILING_WHITESPACE_RE.test(after)) return entity;
    const entityText = text.slice(entity.start, entity.end);
    if (endsWithKnownAbbreviation(entityText)) return entity;
    return {
      ...entity,
      end: entity.end - 1,
      word: typeof entity.word === 'string' ? entity.word.replace(/\.$/, '') : entity.word,
    };
  });
```

- [ ] **Step 6.5: Run the tests to verify they pass**

Run:
```bash
npx vitest run src/pipeline/steps/trim-trailing-dot.test.js
```
Expected: all tests pass, including the new one.

- [ ] **Step 6.6: Run the full suite**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 6.7: Commit**

```bash
git add src/pipeline/steps/trim-trailing-dot.js src/pipeline/steps/trim-trailing-dot.test.js
git commit -m "refactor(trim): gate trimTrailingDotStep on rules.trimTrailingDot

Skips trim for entity types whose rule opts out. Default is true,
so current behavior is preserved."
```

---

## Task 7: Gate `backfillOccurrencesStep` on `rules.backfill`

**Files:**
- Modify: `src/pipeline/steps/backfill.js`
- Create: `src/pipeline/steps/backfill.test.js`

- [ ] **Step 7.1: Write the failing test**

Create `src/pipeline/steps/backfill.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { backfillOccurrencesStep } from './backfill.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      PERSON_NAME: { backfill: true },
      ORGANIZATION_NAME: { backfill: false },
    };
    return map[type] || { backfill: true };
  },
}));

describe('backfillOccurrencesStep', () => {
  it('backfills additional occurrences of a type that opts in', () => {
    const text = 'Jan spotkał Jana. Widział Jana.';
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'PERSON_NAME', start: 0, end: 3, score: 0.9, source: 'polish-q8' },
    ]));
    // Should find other exact-word occurrences via backfill
    expect(result.entities.length).toBeGreaterThan(1);
  });

  it('does not backfill occurrences for types where backfill=false', () => {
    const text = 'Acme Corp paid Acme Corp again.';
    const result = backfillOccurrencesStep(ctx(text, [
      { entity_group: 'ORGANIZATION_NAME', start: 0, end: 9, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
  });
});
```

- [ ] **Step 7.2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/pipeline/steps/backfill.test.js
```
Expected: the `backfill=false` test FAILS (step currently backfills all types).

- [ ] **Step 7.3: Modify `src/pipeline/steps/backfill.js`**

At the top of the file, add after the existing import:
```js
import { rulesFor } from '../configs/entity-rules.js';
```

Modify the `byType` collection loop (around line 32) to skip types with `backfill: false`:

```js
  const byType = new Map();
  for (const e of entities) {
    if (!rulesFor(e.entity_group).backfill) continue;
    const value = text.slice(e.start, e.end);
    if (value.length < MIN_VALUE_LENGTH) continue;
    if (!byType.has(e.entity_group)) byType.set(e.entity_group, new Set());
    byType.get(e.entity_group).add(value);
  }
```

Also gate the PERSON_NAME candidate regex pass on the PERSON_NAME rule. Modify the block starting `const nameValues = byType.get('PERSON_NAME');`:

```js
  const nameValues = byType.get('PERSON_NAME');
  if (nameValues && nameValues.size > 0 && rulesFor('PERSON_NAME').backfill) {
    for (const m of text.matchAll(NAME_CANDIDATE)) {
      // ... unchanged
    }
  }
```

(The `byType.get('PERSON_NAME')` is already empty if backfill is false, so the explicit `&& rulesFor(...)` is belt-and-suspenders for clarity.)

- [ ] **Step 7.4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/pipeline/steps/backfill.test.js
```
Expected: both tests pass.

- [ ] **Step 7.5: Run the full suite**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 7.6: Commit**

```bash
git add src/pipeline/steps/backfill.js src/pipeline/steps/backfill.test.js
git commit -m "refactor(backfill): gate backfillOccurrencesStep on rules.backfill

Types with backfill=false no longer seed rescans. PERSON_NAME
candidate-regex pass respects the flag too. Default is true, so
current behavior is preserved."
```

---

## Task 8: Rewrite `mergeStep` to use `mergeWithAdjacent`

**Files:**
- Modify: `src/pipeline/steps/merge.js`
- Modify: `src/anonymizer.js` (delete `ADDRESS_TYPES` and `mergeAdjacentEntities`; move merge logic into step)
- Create: `src/pipeline/steps/merge.test.js`

- [ ] **Step 8.1: Write the failing tests**

Create `src/pipeline/steps/merge.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { mergeStep } from './merge.js';

function ctx(text, entities) {
  return { text, segments: [], entities, anonymized: '', legend: {} };
}

vi.mock('../configs/entity-rules.js', () => ({
  rulesFor: (type) => {
    const map = {
      POSTAL_ADDRESS: { mergeWithAdjacent: ['LOCATION'] },
      LOCATION: { mergeWithAdjacent: [] },
      PERSON_NAME: { mergeWithAdjacent: [] },
    };
    return map[type] || { mergeWithAdjacent: [] };
  },
}));

describe('mergeStep', () => {
  it('merges same-type adjacent entities with short gap', () => {
    const text = 'ul. Warszawska 5, Kraków';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 16, score: 0.9, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 18, end: 24, score: 0.8, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(24);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
  });

  it('merges LOCATION into adjacent POSTAL_ADDRESS via mergeWithAdjacent', () => {
    const text = 'ul. Warszawska 5, Kraków';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 16, score: 0.9, source: 'polish-q8' },
      { entity_group: 'LOCATION', start: 18, end: 24, score: 0.8, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].end).toBe(24);
  });

  it('merges POSTAL_ADDRESS into adjacent LOCATION (host rule picks POSTAL_ADDRESS)', () => {
    const text = 'Kraków, ul. Warszawska';
    const result = mergeStep(ctx(text, [
      { entity_group: 'LOCATION', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 8, end: 22, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('POSTAL_ADDRESS');
    expect(result.entities[0].start).toBe(0);
    expect(result.entities[0].end).toBe(22);
  });

  it('does not merge cross-type pairs where neither lists the other', () => {
    const text = 'Kraków Kowalski';
    const result = mergeStep(ctx(text, [
      { entity_group: 'LOCATION', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'PERSON_NAME', start: 7, end: 15, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('does not merge when gap exceeds 3 chars', () => {
    const text = 'Kraków  ---  Warszawa';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 13, end: 21, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('does not merge when gap contains non-whitespace/comma characters', () => {
    const text = 'Kraków a Warszawa';
    const result = mergeStep(ctx(text, [
      { entity_group: 'POSTAL_ADDRESS', start: 0, end: 6, score: 0.8, source: 'polish-q8' },
      { entity_group: 'POSTAL_ADDRESS', start: 9, end: 17, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(2);
  });
});
```

- [ ] **Step 8.2: Run the tests to verify they fail or behave inconsistently**

Run:
```bash
npx vitest run src/pipeline/steps/merge.test.js
```
Expected: several tests fail. Current `mergeAdjacentEntities` only merges when both types are in `ADDRESS_TYPES` (`POSTAL_ADDRESS`, `LOCATION`) and always outputs `POSTAL_ADDRESS`. Same-type POSTAL+POSTAL already works (both in set). LOCATION+POSTAL works (both in set). PERSON_NAME+LOCATION already correctly does not merge. The gap tests already pass. So the expected failures: possibly none in the test list above, depending on initial state — but after we delete `ADDRESS_TYPES` the logic MUST come from `mergeWithAdjacent`.

- [ ] **Step 8.3: Rewrite `src/pipeline/steps/merge.js`**

Replace the contents of `src/pipeline/steps/merge.js` with:

```js
import { unionSources } from '../sources.js';
import { rulesFor } from '../configs/entity-rules.js';

const MAX_GAP = 3;
const GAP_RE = /^[\s,\n]*$/;

function canMergePair(prev, curr) {
  if (prev.entity_group === curr.entity_group) return { host: prev.entity_group };
  const prevRule = rulesFor(prev.entity_group);
  const currRule = rulesFor(curr.entity_group);
  if (prevRule.mergeWithAdjacent.includes(curr.entity_group)) return { host: prev.entity_group };
  if (currRule.mergeWithAdjacent.includes(prev.entity_group)) return { host: curr.entity_group };
  return null;
}

export function mergeStep(ctx) {
  const { text, entities } = ctx;
  if (entities.length <= 1) return ctx;

  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const result = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    const curr = sorted[i];

    const gap = text.slice(prev.end, curr.start);
    if (gap.length > MAX_GAP || !GAP_RE.test(gap)) {
      result.push(curr);
      continue;
    }

    const pair = canMergePair(prev, curr);
    if (!pair) {
      result.push(curr);
      continue;
    }

    const mergedSources = unionSources(prev.source, curr.source);
    result[result.length - 1] = {
      entity_group: pair.host,
      start: prev.start,
      end: curr.end,
      score: Math.max(prev.score, curr.score),
      ...(mergedSources.length > 0 && {
        source: mergedSources.length === 1 ? mergedSources[0] : mergedSources,
      }),
    };
  }

  return { ...ctx, entities: result };
}
```

- [ ] **Step 8.4: Remove `ADDRESS_TYPES` and `mergeAdjacentEntities` from `src/anonymizer.js`**

In `src/anonymizer.js`, delete lines 273-308 (the `const ADDRESS_TYPES = new Set(...)` constant and the `mergeAdjacentEntities` function). The `unionSources` import at the top is no longer needed — delete the import line `import { unionSources } from './pipeline/sources.js';` as well.

- [ ] **Step 8.5: Run the merge test to verify it passes**

Run:
```bash
npx vitest run src/pipeline/steps/merge.test.js
```
Expected: all 6 tests pass.

- [ ] **Step 8.6: Run the full suite**

Run:
```bash
npm test
```
Expected: all tests pass. Any test importing `mergeAdjacentEntities` from `anonymizer.js` must be updated — there should be none, but scan the output for failures.

- [ ] **Step 8.7: Commit**

```bash
git add -A
git commit -m "refactor(merge): drive cross-type merging via rules.mergeWithAdjacent

ADDRESS_TYPES set removed from anonymizer.js. mergeStep now reads
mergeWithAdjacent from entity-rules: same-type merges are implicit,
cross-type merges require one side to list the other. Merged type
is the host (the side that listed). Today's POSTAL_ADDRESS + LOCATION
behavior is preserved via POSTAL_ADDRESS.mergeWithAdjacent = ['LOCATION']."
```

---

## Task 9: Wire `thresholdStep` and `blocklistStep` into the pipeline

**Files:**
- Modify: `src/pipeline/configs/default.js`

- [ ] **Step 9.1: Update `src/pipeline/configs/default.js`**

Add imports at the top:
```js
import { thresholdStep } from '../steps/threshold.js';
import { blocklistStep } from '../steps/blocklist.js';
```

Update the postprocess `steps` array to the final order:
```js
{ phase: 'postprocess', steps: [
  createSourceFilterStep({ enabledEntities, entitySources }),
  thresholdStep,
  snapStep,
  trimTrailingDotStep,
  blocklistStep,
  maxLengthStep,
  dedupStep,
  backfillOccurrencesStep,
  mergeStep,
  tokenizeStep,
] },
```

- [ ] **Step 9.2: Run the full test suite**

Run:
```bash
npm test
```
Expected: all tests pass. The new steps are thin gates/filters that act on real config, so any regression will show up here.

- [ ] **Step 9.3: Commit**

```bash
git add src/pipeline/configs/default.js
git commit -m "feat(pipeline): wire threshold and blocklist steps into postprocess

Final postprocess order: sourceFilter, threshold, snap, trimDot,
blocklist, maxLength, dedup, backfill, merge, tokenize. Threshold
runs early to discard low-confidence entities before snap/trim;
blocklist runs after snap/trim so it evaluates the cleaned form."
```

---

## Task 10: Eval regression check (manual verification)

**Files:** none

- [ ] **Step 10.1: Run the post-change eval**

Run:
```bash
npm run eval -- --label=post-entity-rules
```
Expected: completes, prints the result path.

- [ ] **Step 10.2: Compare pre/post runs**

Run:
```bash
npm run eval:compare pre-entity-rules post-entity-rules
```
Expected: the diff shows:
- `PERSON_NAME`: false positives below 0.5 score removed (if any existed in the pre-run).
- `PERSON_ROLE_OR_TITLE`: "Pan", "Pani", "Nadawca" occurrences removed (standalone or edge-trimmed); low-confidence entries below 0.6 (0.75 for polish-q8) removed.
- Other types: no change.

If the diff shows regressions outside the expected scope, investigate. Likely causes:
- Step ordering bug: verify `default.js` matches the final order.
- Threshold value too aggressive: tune down in `entity-rules.js` (update in a follow-up commit, not this one).
- mergeWithAdjacent host picking wrong type: verify the test in Task 8.

- [ ] **Step 10.3: Record eval result**

No commit — eval artifacts live under `test-data/results/`. The `pre-entity-rules` and `post-entity-rules` labels stay available for future comparisons.

---

## Self-Review

**Spec coverage:**
- Config file + `rulesFor` → Task 1 ✓
- `thresholdStep` with per-source overrides → Task 2 ✓
- `blocklistStep` with standalone drop + edge trim → Task 3 ✓
- `maxLengthStep` replacing `filterStep` + removing `MAX_ENTITY_LENGTH` → Task 4 ✓
- `snap` gated on `rules.snap` → Task 5 ✓
- `trimTrailingDot` gated on `rules.trimTrailingDot` → Task 6 ✓
- `backfill` gated on `rules.backfill` (incl. PERSON_NAME candidate pass) → Task 7 ✓
- `merge` using `mergeWithAdjacent`, `ADDRESS_TYPES` removed → Task 8 ✓
- Pipeline wiring with new steps in spec order → Task 9 ✓
- Eval regression check → Tasks 0 + 10 ✓

All spec sections covered.

**Placeholder scan:** No "TBD", "TODO", "implement later", "add appropriate error handling", or "similar to Task N" references. Every step contains exact code or exact commands.

**Type consistency:** `rulesFor` signature stable across tasks. Step names consistent: `thresholdStep`, `blocklistStep`, `maxLengthStep`, `snapStep`, `trimTrailingDotStep`, `backfillOccurrencesStep` (kept its existing name), `mergeStep`. Pipeline order in Task 9 matches spec.
