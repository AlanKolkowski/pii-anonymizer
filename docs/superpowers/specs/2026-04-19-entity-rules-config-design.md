# Per-Entity Rules Configuration

**Date:** 2026-04-19
**Status:** Design approved, awaiting implementation plan

## Problem

Per-entity-type logic is scattered across `src/anonymizer.js` and several postprocess steps:

- `MAX_ENTITY_LENGTH` map in `anonymizer.js` hardcodes per-type size caps.
- `ADDRESS_TYPES` set in `mergeAdjacentEntities` encodes which entities merge.
- `PERSON_NAME` gets special-case name-candidate rescanning in `backfill.js`.
- `ORGANIZATION_NAME` gets lowercasing in `buildTokenMap` (out of scope here).
- No confidence-threshold filter exists at all, despite CLAUDE.md referencing one.

When reviewing eval output, it is hard to answer "what is applied to entity X?" without grepping several files. The same question for tuning ("bump the threshold of PERSON_ROLE_OR_TITLE for polish-q8") has no single place to edit.

The triggering example: `PERSON_ROLE_OR_TITLE` keeps firing on Polish honorifics like "Pan"/"Pani" and sender labels like "Nadawca". Some of these could be filtered by a confidence threshold, but others score highly in context and still need to be dropped — a declarative blocklist is the right shape.

## Goals

- Single per-entity-type config declares every quality/shape rule applied to that type.
- Confidence thresholds, per entity and optionally per source (model alias).
- Declarative blocklist per type: drop standalone matches, trim edge matches.
- Move existing hardcoded per-type logic (`MAX_ENTITY_LENGTH`, `ADDRESS_TYPES`, backfill opt-out) into the same config.
- Rule modules stay small and single-purpose — one step per rule.
- Reading an entity's config entry tells you everything applied to it.
- Undeclared entity types keep today's behavior (backward compatible defaults).

## Non-goals

- Name canonicalization rules (PERSON_NAME grouping, ORG lowercasing in `buildTokenMap`) stay hardcoded for now.
- UI for editing rules — config stays in code.
- Changes to NER step, segmentation, or regex patterns.
- Scoring algorithm in `src/eval/score.js`.

## Architecture

### New file: `src/pipeline/configs/entity-rules.js`

Central config, one entry per entity type. A `DEFAULT_RULE` object provides conservative defaults so undeclared types behave as they do today.

```js
export const DEFAULT_RULE = {
  threshold: 0,            // accept anything unless overridden
  thresholdBySource: {},   // per-source overrides
  maxLength: null,         // null = no limit
  snap: true,
  trimTrailingDot: true,
  backfill: true,
  blocklist: [],           // case-insensitive, matched against entity text
  mergeWithAdjacent: [],   // entity types this one may absorb when nearby
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

Initial per-type values preserve today's `MAX_ENTITY_LENGTH` map (minus the dead `PROPER_NAME` entry, which has no `ENTITY_SOURCES` mapping and never reaches postprocess). Threshold values for `PERSON_NAME` and `PERSON_ROLE_OR_TITLE` are informed starting points; everything else is defaulted (0) — tune via eval iteration.

### Pipeline order (postprocess phase)

```
sourceFilter → threshold → snap → trimTrailingDot → blocklist
  → maxLength → dedup → backfill → merge → tokenize
```

Rationale:
- **Threshold early** — drops low-confidence entities before we waste work snapping/trimming them.
- **Blocklist after snap+trim** — evaluates the cleaned form of the entity. `"Pan "` emitted by the model gets snapped/trimmed first, then the blocklist sees `"Pan"` and drops it.
- **maxLength before dedup** — we don't want oversized hallucinations competing in dedup.
- **Merge after dedup** — same as today.

### Rule modules

Each rule is its own step file. Steps import `rulesFor` directly from `entity-rules.js` — no factory, no DI plumbing. This matches how `entity-sources.js` is used elsewhere.

#### `threshold.js` (new)
```
keep entity iff entity.score >=
  (rules.thresholdBySource[entity.source] ?? rules.threshold)
```
If `entity.source` is an array (can happen post-merge — but threshold runs before merge), fall back to `rules.threshold`.

#### `blocklist.js` (new)
For each entity, take current `text.slice(start, end)`:
- **Standalone drop:** trimmed lowercased value ∈ `rules.blocklist` → drop.
- **Edge trim:** iteratively, if the entity text starts with `blocked + whitespace`, advance `start` past it; symmetrically at the end. Repeat until no more edge matches.
- If the span becomes empty or whitespace-only after trimming, drop.

Case folding: `.toLowerCase()` on both sides. No diacritic folding — out of scope.

#### `max-length.js` (replaces `filter.js`)
Reads `rules.maxLength`. Drops entities where `(end - start) > maxLength` when `maxLength != null`. Replaces `filterOversizedEntities` + `MAX_ENTITY_LENGTH` in `anonymizer.js`.

Debug step name changes: `filterStep` → `maxLengthStep`. Called out in the commit.

#### `snap.js` (modified)
Keep the universal snap algorithm in `anonymizer.js` (`snapToWordBoundaries`). The step wraps it:
```js
entities.map(e => rulesFor(e.entity_group).snap ? snapOne(e) : e)
```
(Or equivalent — partition vs map, whichever is cleanest.)

#### `trim-trailing-dot.js` (modified)
Skip entities where `rules.trimTrailingDot === false` at loop head. Rest of logic unchanged.

#### `backfill.js` (modified)
Two gates:
- Skip types where `rules.backfill === false` when collecting `byType` (they don't seed rescans).
- Gate the `PERSON_NAME` candidate-regex pass on `rulesFor('PERSON_NAME').backfill !== false`.

#### `merge.js` (modified)
`ADDRESS_TYPES` set removed from `anonymizer.js`. New predicate for "these two can merge":
- **Same type:** always mergeable (covers today's two-address → one-address case). Merged result keeps that type.
- **Cross-type:** mergeable iff either side's `mergeWithAdjacent` lists the other:
  `prev.mergeWithAdjacent.includes(curr.type) || curr.mergeWithAdjacent.includes(prev.type)`.
  Merged result type = the side whose list contained the other ("host"). If both declare each other, `prev` wins (deterministic by scan order).

Example: with `POSTAL_ADDRESS.mergeWithAdjacent = ['LOCATION']`, a `LOCATION` next to a `POSTAL_ADDRESS` (in either order) merges into a `POSTAL_ADDRESS` — matching today's behavior.

The existing gap/whitespace constraint (≤ 3 chars matching `/^[\s,\n]*$/`) is preserved.

## Data flow

```
NER entities
  → sourceFilter  (drop non-authoritative, per ENTITY_SOURCES)
  → threshold     (drop below per-source or per-type threshold)
  → snap          (skip if rules.snap === false)
  → trimDot       (skip if rules.trimTrailingDot === false)
  → blocklist     (drop standalone matches, trim edges)
  → maxLength     (drop oversized, per rules.maxLength)
  → dedup
  → backfill      (skip types with rules.backfill === false)
  → merge         (same-type always; cross-type via mergeWithAdjacent)
  → tokenize
```

Each step is testable in isolation: feed a `ctx`, assert on the returned `ctx.entities`.

## Error handling

- Unknown entity type in `rulesFor` → return `DEFAULT_RULE`. No throw, no warning. Forward-compatible with types coming from new models.
- Empty blocklist / missing fields → defaults fill in. No validation layer; schema is informal.
- Entity with no `source` field (shouldn't happen post `sourceFilter`) → threshold uses `rules.threshold` default.

## Testing

**New test files:**
- `src/pipeline/steps/threshold.test.js` — default threshold, per-source override, boundary scores, unknown-type defaults to 0.
- `src/pipeline/steps/blocklist.test.js` — standalone drop, edge trim both sides, iterative (`"Pan Pan Kowalski"` → `"Kowalski"`), span-becomes-empty drop, case folding, unrelated types untouched.
- `src/pipeline/steps/max-length.test.js` — configured type drops oversized; unconfigured type keeps everything.
- `src/pipeline/steps/merge.test.js` — existing `merge.js` coverage (if any) expands to cover same-type and cross-type via `mergeWithAdjacent`.

**Regression check:**
- Run `npm run eval -- --label=pre-entity-rules` on current main.
- Run `npm run eval -- --label=post-entity-rules` after change.
- `npm run eval:compare pre-entity-rules post-entity-rules` — expect threshold-driven changes on `PERSON_NAME` and `PERSON_ROLE_OR_TITLE`, no regressions elsewhere.

## Migration

**File deltas:**
- **New:** `src/pipeline/configs/entity-rules.js`, `src/pipeline/steps/threshold.js`, `src/pipeline/steps/blocklist.js`, `src/pipeline/steps/max-length.js` + tests for each.
- **Modified:** `src/pipeline/steps/snap.js`, `src/pipeline/steps/trim-trailing-dot.js`, `src/pipeline/steps/merge.js`, `src/pipeline/steps/backfill.js`, `src/pipeline/configs/default.js`, `src/anonymizer.js` (delete `MAX_ENTITY_LENGTH`, `filterOversizedEntities`, `ADDRESS_TYPES`).
- **Deleted:** `src/pipeline/steps/filter.js` (replaced by `max-length.js`).

**External callers:** `filterOversizedEntities` is only used by `filter.js`; safe to remove both together. `MAX_ENTITY_LENGTH` is unexported.

**Behavioral diff vs. today:**
- New: threshold filter on `PERSON_NAME` (≥ 0.5) and `PERSON_ROLE_OR_TITLE` (≥ 0.6, ≥ 0.75 for polish-q8).
- New: `PERSON_ROLE_OR_TITLE` blocklist drops "Pan"/"Pani"/"Nadawca" (standalone and edge).
- Unchanged: all max-length caps, all address-merge behavior, all backfill behavior.

## Open questions

None. All decisions locked during brainstorming.
