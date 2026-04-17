# Entity → Source Mapping & Per-Entity UI Selection

**Date:** 2026-04-17
**Status:** Design approved, awaiting implementation plan

## Problem

Today every model in `MODELS` is loaded at startup and every detected entity type is kept (filtered by a hard-coded `ALLOWED_TYPES` set in `allowedTypesStep`). There is no way to:

1. Declare which model/quantization is authoritative for a given entity type.
2. Let the user pick which entity types should be anonymized.
3. Avoid downloading a model when the user is not interested in any entity it covers (important once heavier models for Health/Special-categories land).

## Goals

- A single config file maps each entity type to the list of sources (model aliases + regex) that are authoritative for it.
- The web UI exposes an entity picker grouped by the categories in `docs/entity-categories.md` with per-entity checkboxes and tri-state category checkboxes.
- The pipeline only loads models that are required for the user's current selection.
- Entities returned by a model that is **not** in `entitySources[entity_group]` are dropped in postprocessing.
- Eval CLI keeps the current "check everything" default and adds an opt-in `--entities=...` flag.
- No explicit "download model" step in the UI — first `classify` lazily loads what it needs.

## Non-goals

- Changing the scoring algorithm in `src/eval/score.js`.
- Introducing a UI preset editor (presets live in code).
- Any change to the deanonymization flow.
- Adding a UI for editing the entity → source map (that stays in code for now).

## Architecture

### 1. Config — single source of truth

New file `src/pipeline/configs/entity-sources.js`:

```js
// Every source in the pipeline is either an HF model at a specific dtype or "regex".
// Aliases decouple human-friendly identifiers from raw HF ids, and let the same
// model appear in different quantizations as distinct sources.
export const SOURCES = {
  'multilang-q8': { kind: 'hf', id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' },
  'polish-q8':    { kind: 'hf', id: 'bardsai/eu-pii-anonimization', dtype: 'q8' },
  'regex':        { kind: 'regex' },
};

// Which sources are authoritative for each entity type.
// Entities produced by a non-authoritative source are dropped in postprocess.
export const ENTITY_SOURCES = {
  PERSON_NAME:              ['multilang-q8', 'polish-q8'],
  DATE_OF_BIRTH:            ['multilang-q8', 'polish-q8'],
  PERSON_ATTRIBUTE:         ['multilang-q8', 'polish-q8'],
  PERSON_ALIAS:             ['multilang-q8', 'polish-q8'],
  PERSON_IDENTIFIER:        ['multilang-q8', 'polish-q8', 'regex'],
  PERSON_ROLE_OR_TITLE:     ['multilang-q8', 'polish-q8'],
  ORGANIZATION_NAME:        ['multilang-q8', 'polish-q8'],
  ORGANIZATION_IDENTIFIER:  ['multilang-q8', 'polish-q8', 'regex'],
  EMAIL_ADDRESS:            ['multilang-q8', 'polish-q8', 'regex'],
  PHONE_NUMBER:             ['multilang-q8', 'polish-q8', 'regex'],
  CONTACT_HANDLE:           ['multilang-q8', 'polish-q8'],
  POSTAL_ADDRESS:           ['multilang-q8', 'polish-q8'],
  LOCATION:                 ['multilang-q8', 'polish-q8'],
  GEO_LOCATION:             ['multilang-q8', 'polish-q8'],
  IP_ADDRESS:               ['multilang-q8', 'polish-q8'],
  DEVICE_IDENTIFIER:        ['multilang-q8', 'polish-q8'],
  COOKIE_IDENTIFIER:        ['multilang-q8', 'polish-q8'],
  ACCOUNT_IDENTIFIER:       ['multilang-q8', 'polish-q8'],
  AUTH_SECRET:              ['multilang-q8', 'polish-q8'],
  BANK_ACCOUNT_IDENTIFIER:  ['multilang-q8', 'polish-q8', 'regex'],
  PAYMENT_CARD:             ['multilang-q8', 'polish-q8'],
  PAYMENT_CARD_SECURITY:    ['multilang-q8', 'polish-q8'],
  DOCUMENT_REFERENCE:       ['multilang-q8', 'polish-q8'],
  FINANCIAL_AMOUNT:         ['multilang-q8', 'polish-q8', 'regex'],
  INCOME_COMPENSATION:      ['multilang-q8', 'polish-q8'],
  VEHICLE_IDENTIFIER:       ['multilang-q8', 'polish-q8'],
  HEALTH_DATA:              ['multilang-q8', 'polish-q8'],
  GENETIC_DATA:             ['multilang-q8', 'polish-q8'],
  BIOMETRIC_DATA:           ['multilang-q8', 'polish-q8'],
  RELIGION_OR_BELIEF:       ['multilang-q8', 'polish-q8'],
  POLITICAL_OPINION:        ['multilang-q8', 'polish-q8'],
  SEXUAL_ORIENTATION:       ['multilang-q8', 'polish-q8'],
  TRADE_UNION_MEMBERSHIP:   ['multilang-q8', 'polish-q8'],
  ETHNIC_ORIGIN:            ['multilang-q8', 'polish-q8'],
  CRIMINAL_OFFENCE_DATA:    ['multilang-q8', 'polish-q8'],
};

// UI structure. Entities listed here must also appear in ENTITY_SOURCES (sanity-checked in tests).
// Employment (category 8 in docs) is intentionally omitted because its only entity
// (PERSON_ROLE_OR_TITLE) is already covered in Personal Identity.
export const ENTITY_CATEGORIES = [
  { id: 'personal-identity',      label: 'Personal Identity',     entities: ['PERSON_NAME', 'DATE_OF_BIRTH', 'PERSON_ATTRIBUTE', 'PERSON_ALIAS', 'PERSON_IDENTIFIER', 'PERSON_ROLE_OR_TITLE'] },
  { id: 'organizations',          label: 'Organizations',         entities: ['ORGANIZATION_NAME', 'ORGANIZATION_IDENTIFIER'] },
  { id: 'contact-location',       label: 'Contact & Location',    entities: ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'CONTACT_HANDLE', 'POSTAL_ADDRESS', 'LOCATION', 'GEO_LOCATION'] },
  { id: 'technical-identifiers',  label: 'Technical Identifiers', entities: ['IP_ADDRESS', 'DEVICE_IDENTIFIER', 'COOKIE_IDENTIFIER', 'ACCOUNT_IDENTIFIER', 'AUTH_SECRET'] },
  { id: 'financial',              label: 'Financial',             entities: ['BANK_ACCOUNT_IDENTIFIER', 'PAYMENT_CARD', 'PAYMENT_CARD_SECURITY', 'DOCUMENT_REFERENCE', 'FINANCIAL_AMOUNT', 'INCOME_COMPENSATION', 'VEHICLE_IDENTIFIER'] },
  { id: 'health-biometric',       label: 'Health & Biometric',    entities: ['HEALTH_DATA', 'GENETIC_DATA', 'BIOMETRIC_DATA'] },
  { id: 'special-categories',     label: 'Special Categories',    entities: ['RELIGION_OR_BELIEF', 'POLITICAL_OPINION', 'SEXUAL_ORIENTATION', 'TRADE_UNION_MEMBERSHIP', 'ETHNIC_ORIGIN', 'CRIMINAL_OFFENCE_DATA'] },
];

// Default UI selection = categories 1–5 (Health and Special Categories are off by default
// because they may later be backed by a heavier model).
export const DEFAULT_ENABLED_CATEGORIES = [
  'personal-identity', 'organizations', 'contact-location',
  'technical-identifiers', 'financial',
];

// Human-readable labels for the UI (short form, matching docs/entity-categories.md).
export const ENTITY_LABELS = {
  PERSON_NAME:              'Full name',
  DATE_OF_BIRTH:            'Date of birth',
  PERSON_ATTRIBUTE:         'Age, gender, nationality',
  PERSON_ALIAS:             'Nickname, username',
  PERSON_IDENTIFIER:        'National ID, passport, tax ID',
  PERSON_ROLE_OR_TITLE:     'Job title / role',
  ORGANIZATION_NAME:        'Organization name',
  ORGANIZATION_IDENTIFIER:  'NIP, KRS, REGON',
  EMAIL_ADDRESS:            'Email address',
  PHONE_NUMBER:             'Phone number',
  CONTACT_HANDLE:           'Social handle / messaging ID',
  POSTAL_ADDRESS:           'Postal address',
  LOCATION:                 'City / region / country',
  GEO_LOCATION:             'GPS coordinates',
  IP_ADDRESS:               'IP address',
  DEVICE_IDENTIFIER:        'MAC / IMEI / serial',
  COOKIE_IDENTIFIER:        'Cookie / tracker ID',
  ACCOUNT_IDENTIFIER:       'User / account ID',
  AUTH_SECRET:              'Password / API key',
  BANK_ACCOUNT_IDENTIFIER:  'Bank account / IBAN',
  PAYMENT_CARD:             'Payment card number',
  PAYMENT_CARD_SECURITY:    'Card expiry / CVV',
  DOCUMENT_REFERENCE:       'Invoice / transaction ref',
  FINANCIAL_AMOUNT:         'Monetary amount',
  INCOME_COMPENSATION:      'Salary / compensation',
  VEHICLE_IDENTIFIER:       'License plate / VIN',
  HEALTH_DATA:              'Diagnosis / medical condition',
  GENETIC_DATA:             'Genetic data',
  BIOMETRIC_DATA:           'Biometric data',
  RELIGION_OR_BELIEF:       'Religion / belief',
  POLITICAL_OPINION:        'Political opinion',
  SEXUAL_ORIENTATION:       'Sexual orientation',
  TRADE_UNION_MEMBERSHIP:   'Trade union membership',
  ETHNIC_ORIGIN:            'Ethnic origin',
  CRIMINAL_OFFENCE_DATA:    'Criminal offence data',
};

// Derived helpers.
export function defaultEnabledEntities() { ... }   // union of entities in DEFAULT_ENABLED_CATEGORIES
export function allEntityTypes() { ... }           // Object.keys(ENTITY_SOURCES)
export function requiredSources(enabledEntities) { ... }  // union of ENTITY_SOURCES[e] for e in enabledEntities
```

### 2. Pipeline changes

`createDefaultPipeline(loadModel, getSentenceBoundaries, pipelineOptions)` — third argument becomes mandatory and carries:

```js
{
  enabledEntities: string[],          // user's selection
  entitySources:   Record<string, string[]>,  // usually ENTITY_SOURCES
  sources:         Record<string, SourceDef>, // usually SOURCES
}
```

From these it computes the active HF source list `[{ alias, id, dtype }, ...]` and whether the regex source is active.

Per-step changes:

- **`createNerStep(activeHfSources, loadModel)`** — iterates the active HF sources (alias-aware) and writes `entity.source = alias` (was `entity.source = model.id`).
- **`regexStep`** — becomes a factory `createRegexStep(regexActive)` that no-ops when regex is not in the active source list. Regex entities continue to carry `source: 'regex'`.
- **New `createSourceFilterStep({ enabledEntities, entitySources })`** — replaces `allowedTypesStep`:
  - Drops entities whose `entity_group` is not in `enabledEntities`.
  - Drops entities whose `source` does not intersect `entitySources[entity_group]`.
  - `source` may be a string or an array (post-merge); the check is a set intersection.
  - Entities lacking a `source` (legacy/unexpected) are dropped — logged once per run in debug output.
- **`rescanStep`** — operates on the existing legend, so it automatically respects the user's selection (no extra change needed).
- **`allowedTypesStep`** is deleted.

### 3. Worker — new message protocol

`src/worker.js` replaces the current `load`/`classify` flow with `configure`/`classify` (no download button in the UI).

Worker state:

```js
let wasmReady = false;               // resolved once by init(sentencexWasm)
let config = null;                   // { enabledEntities, requiredSources }
const loadedModels = new Map();      // alias -> { ner, dispose }
```

Message handlers:

- `configure { enabledEntities }`
  - Ensures WASM is initialized (lazy on first configure).
  - Computes `requiredSources(enabledEntities)`.
  - Disposes any cached model whose alias is no longer required.
  - Does **not** preload models. Replies `{ type: 'configured', requiredSources: [...] }`.
- `classify { text }`
  - For each HF alias in the current `requiredSources` that is not in `loadedModels`, loads it via `@huggingface/transformers` with the standard `progress_callback` forwarding `{ type: 'progress', file, progress }`.
  - Caches the result in `loadedModels` (no per-classify dispose).
  - Builds `pipelineConfig = createDefaultPipeline(...)` with the current selection and runs it.
  - Replies with the existing `{ type: 'result', data, anonymized, legend, debug }`.

Error cases:
- Empty `enabledEntities` → worker replies `{ type: 'error', message: 'No entities enabled' }` (the UI should already prevent this; defense-in-depth).
- Model load failure → `{ type: 'error', message }` (same contract as today).

### 4. UI — entity picker

New module `src/ui/entity-selector.js` (vanilla JS, no framework):

```js
createEntitySelector(container, {
  categories,         // ENTITY_CATEGORIES
  labels,             // ENTITY_LABELS
  initial,            // string[] of initially-enabled entity groups
  onChange(selected), // callback with string[] of currently enabled entity groups
})
  → { getSelected(), setSelected(entities), destroy() }
```

Rendering:
- Each category is a `<fieldset>` with a `<legend>` containing the category checkbox + label + count `(N/M)`.
- Entities render as `<label><input type="checkbox"> Full name <code>(PERSON_NAME)</code></label>`.
- Category checkbox is tri-state (`indeterminate` when some but not all children are checked).
- Two-column responsive grid via CSS grid, collapsing to one column below ~640px.

Behavior:
- Clicking a category checkbox toggles all children (all-off → all-on; any-on → all-off).
- Per-entity change re-evaluates the category state.
- `onChange` emits the flat list of enabled entities; it is **not** fired while `setSelected` runs.

`src/main.js` changes:
1. Imports `createEntitySelector`, `ENTITY_CATEGORIES`, `defaultEnabledEntities`.
2. At startup:
   - Reads `localStorage['pii.selected-entities']`; falls back to `defaultEnabledEntities()`.
   - Builds the selector into a new `<section id="entity-selector">`.
   - Posts `configure { enabledEntities }` to the worker immediately.
3. `onChange` → debounce 300 ms → save to localStorage + post `configure`.
4. "Pobierz model" button and its handler are removed. `modelStatus` element is repurposed to show progress during the first classify (file name + %) and becomes empty between runs.
5. `anonymize-btn` is enabled iff `enabledEntities.length > 0` and no classify is in flight.
6. `handleAnonymizationResult` is unchanged.

`index.html` changes:
- New `<section id="entity-selector-section">` before the input textarea.
- "Pobierz model" button removed from the toolbar.

### 5. Eval CLI

`src/eval/run.js`:
- Parses `--entities=TYPE1,TYPE2,...`. When absent, uses `allEntityTypes()` (every key of `ENTITY_SOURCES`).
- Validates each supplied type against `ENTITY_SOURCES`; exits with a list of valid types on mismatch.
- Calls `createDefaultPipeline(loadModel, sentenceBoundaries, { enabledEntities, entitySources: ENTITY_SOURCES, sources: SOURCES })`.
- Adds `enabledEntities` and (if non-default) `entitiesSubset: true` to the `summary.json` for reproducibility.

`src/eval/score.js` is unchanged: it already scores whatever entities the pipeline emitted.

### 6. Debug panel

`entity.source` is now an alias, which is more readable than the raw HF id — no rendering changes required. `debug.json` likewise carries aliases.

## Data flow summary

```
UI (selector)
   ├─ localStorage hydrate
   ├─ onChange (debounced) ──▶ worker: configure { enabledEntities }
   │                               └─ dispose unused models, recompute requiredSources
   └─ anonymize click ─────▶ worker: classify { text }
                                  ├─ ensure each requiredSource loaded (progress events)
                                  ├─ build pipelineConfig with current selection
                                  └─ run pipeline ──▶ result
```

## Testing strategy

Unit (vitest):
- `src/pipeline/configs/entity-sources.test.js` — every entity in `ENTITY_CATEGORIES` has a mapping in `ENTITY_SOURCES`; every alias referenced by `ENTITY_SOURCES` exists in `SOURCES`; `defaultEnabledEntities()` returns the union of entities in `DEFAULT_ENABLED_CATEGORIES`.
- `src/pipeline/steps/source-filter.test.js` — keeps authoritative-source entities, drops off-source entities, drops disabled-type entities, handles `source` as array via intersection, drops entities lacking `source`.
- `src/pipeline/steps/ner.test.js` — NER step writes `source: alias` (not raw id).
- Existing `src/pipeline/steps/steps.test.js` — update for `sourceFilterStep` replacing `allowedTypesStep`.
- `src/ui/entity-selector.test.js` — optional; only if tri-state logic can be exercised without heavy DOM plumbing.

Manual:
- `npm run build` succeeds.
- Browser smoke test: default categories visible and checked (1–5); refresh preserves selection; first classify shows progress; second classify skips progress; enabling Health triggers progress once; zero-selection disables the anonymize button.
- `npm run eval -- --label=entity-sources-baseline` matches last full run within tolerance.
- `npm run eval -- --label=entity-sources-subset --entities=PERSON_NAME,EMAIL_ADDRESS,PHONE_NUMBER` produces only those entity types.

## Open items

None.
