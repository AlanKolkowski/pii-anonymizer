# Entity → Source Mapping & Per-Entity UI Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick which entity types to anonymize, with a single config mapping each entity to the source(s) (model alias or regex) authoritative for it; load only the models actually needed.

**Architecture:** A central `entity-sources.js` config holds source aliases, entity→sources mapping, UI categories and labels. The pipeline receives `{ enabledEntities, entitySources, sources }` and computes active sources at build time. A new `sourceFilterStep` replaces the old hard-coded allow-list by filtering by both entity type and authoritative source alias. The web worker switches from a `load`/`classify` flow to `configure`/`classify`, lazy-loading HF models on first classify and caching them. The UI renders a grouped checkbox list (tri-state categories), persists selection in `localStorage`, and removes the explicit "download model" button.

**Tech Stack:** Vanilla JS + Vite + Web Worker + `@huggingface/transformers` + vitest.

---

## File Structure

Created:
- `src/pipeline/configs/entity-sources.js` — source aliases, entity→sources map, UI categories/labels, helpers.
- `src/pipeline/configs/entity-sources.test.js` — sanity tests for the config.
- `src/pipeline/steps/source-filter.js` — `createSourceFilterStep` (replaces `allowedTypesStep`).
- `src/pipeline/steps/source-filter.test.js` — tests for the new step.
- `src/ui/entity-selector.js` — DOM component that renders the grouped entity picker.

Modified:
- `src/pipeline/configs/default.js` — accept `{ enabledEntities, entitySources, sources }`, wire new steps.
- `src/pipeline/steps/ner.js` — write `source: alias`, accept `[{ alias, id, dtype }, ...]`.
- `src/pipeline/steps/regex.js` — factory `createRegexStep(regexActive)`; keep `source: 'regex'`.
- `src/pipeline/steps/steps.test.js` — update for new NER/regex signatures; drop allowed-types test.
- `src/worker.js` — new `configure`/`classify` protocol, model cache keyed by alias.
- `src/main.js` — integrate `createEntitySelector`, new worker protocol, localStorage, drop download button.
- `index.html` — add entity selector section, remove `#model-section` download button (keep status).
- `src/style.css` — styles for the selector.
- `src/eval/run.js` — `--entities=` flag, new pipeline config shape, write `enabledEntities` into summary.

Deleted:
- `src/pipeline/steps/allowed-types.js` (replaced by `source-filter.js`).

---

## Task 1: Add `entity-sources.js` config

**Files:**
- Create: `src/pipeline/configs/entity-sources.js`

- [ ] **Step 1: Write the config file**

Create `src/pipeline/configs/entity-sources.js`:

```js
// Every source in the pipeline is either an HF model at a specific dtype or "regex".
// Aliases decouple human-friendly ids from raw HF ids and let the same model appear
// in multiple quantizations as distinct sources.
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

// Human-readable labels for the UI.
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

// UI structure. Employment (docs category 8) is omitted because its only entity
// (PERSON_ROLE_OR_TITLE) already appears in Personal Identity.
export const ENTITY_CATEGORIES = [
  { id: 'personal-identity',     label: 'Personal Identity',     entities: ['PERSON_NAME', 'DATE_OF_BIRTH', 'PERSON_ATTRIBUTE', 'PERSON_ALIAS', 'PERSON_IDENTIFIER', 'PERSON_ROLE_OR_TITLE'] },
  { id: 'organizations',         label: 'Organizations',         entities: ['ORGANIZATION_NAME', 'ORGANIZATION_IDENTIFIER'] },
  { id: 'contact-location',      label: 'Contact & Location',    entities: ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'CONTACT_HANDLE', 'POSTAL_ADDRESS', 'LOCATION', 'GEO_LOCATION'] },
  { id: 'technical-identifiers', label: 'Technical Identifiers', entities: ['IP_ADDRESS', 'DEVICE_IDENTIFIER', 'COOKIE_IDENTIFIER', 'ACCOUNT_IDENTIFIER', 'AUTH_SECRET'] },
  { id: 'financial',             label: 'Financial',             entities: ['BANK_ACCOUNT_IDENTIFIER', 'PAYMENT_CARD', 'PAYMENT_CARD_SECURITY', 'DOCUMENT_REFERENCE', 'FINANCIAL_AMOUNT', 'INCOME_COMPENSATION', 'VEHICLE_IDENTIFIER'] },
  { id: 'health-biometric',      label: 'Health & Biometric',    entities: ['HEALTH_DATA', 'GENETIC_DATA', 'BIOMETRIC_DATA'] },
  { id: 'special-categories',    label: 'Special Categories',    entities: ['RELIGION_OR_BELIEF', 'POLITICAL_OPINION', 'SEXUAL_ORIENTATION', 'TRADE_UNION_MEMBERSHIP', 'ETHNIC_ORIGIN', 'CRIMINAL_OFFENCE_DATA'] },
];

export const DEFAULT_ENABLED_CATEGORIES = [
  'personal-identity', 'organizations', 'contact-location',
  'technical-identifiers', 'financial',
];

export function allEntityTypes() {
  return Object.keys(ENTITY_SOURCES);
}

export function defaultEnabledEntities() {
  const out = [];
  for (const cat of ENTITY_CATEGORIES) {
    if (DEFAULT_ENABLED_CATEGORIES.includes(cat.id)) {
      out.push(...cat.entities);
    }
  }
  return out;
}

// Union of source aliases needed to detect the given entity types.
export function requiredSources(enabledEntities) {
  const set = new Set();
  for (const type of enabledEntities) {
    const sources = ENTITY_SOURCES[type];
    if (!sources) continue;
    for (const s of sources) set.add(s);
  }
  return [...set];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline/configs/entity-sources.js
git commit -m "feat(config): add entity-sources config (aliases, mapping, categories)"
```

---

## Task 2: Tests for `entity-sources.js`

**Files:**
- Create: `src/pipeline/configs/entity-sources.test.js`

- [ ] **Step 1: Write tests**

Create `src/pipeline/configs/entity-sources.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  SOURCES,
  ENTITY_SOURCES,
  ENTITY_LABELS,
  ENTITY_CATEGORIES,
  DEFAULT_ENABLED_CATEGORIES,
  allEntityTypes,
  defaultEnabledEntities,
  requiredSources,
} from './entity-sources.js';

describe('entity-sources config', () => {
  it('every alias used in ENTITY_SOURCES exists in SOURCES', () => {
    const aliases = new Set(Object.keys(SOURCES));
    for (const [entity, sources] of Object.entries(ENTITY_SOURCES)) {
      for (const alias of sources) {
        expect(aliases.has(alias), `${entity} references unknown source "${alias}"`).toBe(true);
      }
    }
  });

  it('every entity in ENTITY_CATEGORIES exists in ENTITY_SOURCES', () => {
    const known = new Set(Object.keys(ENTITY_SOURCES));
    for (const cat of ENTITY_CATEGORIES) {
      for (const entity of cat.entities) {
        expect(known.has(entity), `category "${cat.id}" references unknown entity "${entity}"`).toBe(true);
      }
    }
  });

  it('every entity in ENTITY_SOURCES has a label', () => {
    for (const entity of Object.keys(ENTITY_SOURCES)) {
      expect(ENTITY_LABELS[entity], `missing label for ${entity}`).toBeTypeOf('string');
    }
  });

  it('every DEFAULT_ENABLED_CATEGORIES id exists in ENTITY_CATEGORIES', () => {
    const catIds = new Set(ENTITY_CATEGORIES.map(c => c.id));
    for (const id of DEFAULT_ENABLED_CATEGORIES) {
      expect(catIds.has(id), `unknown default category "${id}"`).toBe(true);
    }
  });

  it('allEntityTypes returns every key in ENTITY_SOURCES', () => {
    expect(allEntityTypes().sort()).toEqual(Object.keys(ENTITY_SOURCES).sort());
  });

  it('defaultEnabledEntities returns union of entities in default categories', () => {
    const expected = ENTITY_CATEGORIES
      .filter(c => DEFAULT_ENABLED_CATEGORIES.includes(c.id))
      .flatMap(c => c.entities);
    expect(defaultEnabledEntities().sort()).toEqual(expected.sort());
  });

  it('requiredSources is empty for empty selection', () => {
    expect(requiredSources([])).toEqual([]);
  });

  it('requiredSources returns union of aliases for selected entities', () => {
    // PERSON_NAME → [multilang-q8, polish-q8]; EMAIL_ADDRESS adds regex.
    const got = requiredSources(['PERSON_NAME', 'EMAIL_ADDRESS']).sort();
    expect(got).toEqual(['multilang-q8', 'polish-q8', 'regex'].sort());
  });

  it('requiredSources ignores unknown entity types', () => {
    expect(requiredSources(['NOT_A_REAL_TYPE'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify pass**

Run: `npx vitest run src/pipeline/configs/entity-sources.test.js`
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/configs/entity-sources.test.js
git commit -m "test(config): sanity tests for entity-sources config"
```

---

## Task 3: Add `source-filter.js` step

**Files:**
- Create: `src/pipeline/steps/source-filter.js`
- Create: `src/pipeline/steps/source-filter.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/pipeline/steps/source-filter.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createSourceFilterStep } from './source-filter.js';

function ctx(entities) {
  return { text: '', segments: [], entities, anonymized: '', legend: {} };
}

describe('createSourceFilterStep', () => {
  const entitySources = {
    PERSON_NAME:    ['multilang-q8', 'polish-q8'],
    EMAIL_ADDRESS:  ['multilang-q8', 'regex'],
  };

  it('keeps entities whose source is authoritative for the type', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME', 'EMAIL_ADDRESS'],
      entitySources,
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'polish-q8' },
      { entity_group: 'EMAIL_ADDRESS', start: 10, end: 25, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(2);
  });

  it('drops entities whose source is not authoritative for the type', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources: { PERSON_NAME: ['polish-q8'] },  // multilang is NOT authoritative
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'multilang-q8' },
      { entity_group: 'PERSON_NAME', start: 6, end: 10, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].source).toBe('polish-q8');
  });

  it('drops entities whose type is not in enabledEntities', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources,
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'polish-q8' },
      { entity_group: 'EMAIL_ADDRESS', start: 10, end: 25, score: 1.0, source: 'regex' },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('PERSON_NAME');
  });

  it('treats array-valued source as intersection with authoritative set', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources: { PERSON_NAME: ['polish-q8'] },
    });
    const result = step(ctx([
      // merged entity with two sources — polish-q8 IS authoritative → keep
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: ['multilang-q8', 'polish-q8'] },
      // merged entity whose only sources are non-authoritative → drop
      { entity_group: 'PERSON_NAME', start: 6, end: 10, score: 0.9, source: ['multilang-q8', 'regex'] },
    ]));
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].start).toBe(0);
  });

  it('drops entities without a source', () => {
    const step = createSourceFilterStep({
      enabledEntities: ['PERSON_NAME'],
      entitySources,
    });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9 },
    ]));
    expect(result.entities).toHaveLength(0);
  });

  it('drops all entities when enabledEntities is empty', () => {
    const step = createSourceFilterStep({ enabledEntities: [], entitySources });
    const result = step(ctx([
      { entity_group: 'PERSON_NAME', start: 0, end: 5, score: 0.9, source: 'polish-q8' },
    ]));
    expect(result.entities).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npx vitest run src/pipeline/steps/source-filter.test.js`
Expected: FAIL — cannot resolve `./source-filter.js`.

- [ ] **Step 3: Write the step**

Create `src/pipeline/steps/source-filter.js`:

```js
import { sourcesToArray } from '../sources.js';

// Factory: builds a step that keeps only entities whose type is enabled AND
// whose source is authoritative for that type.
export function createSourceFilterStep({ enabledEntities, entitySources }) {
  const enabled = new Set(enabledEntities);

  return function sourceFilterStep(ctx) {
    const filtered = ctx.entities.filter((entity) => {
      if (!enabled.has(entity.entity_group)) return false;
      const authoritative = entitySources[entity.entity_group];
      if (!authoritative || authoritative.length === 0) return false;
      const auth = new Set(authoritative);
      const entitySources_ = sourcesToArray(entity.source);
      if (entitySources_.length === 0) return false;
      return entitySources_.some((s) => auth.has(s));
    });
    return { ...ctx, entities: filtered };
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/pipeline/steps/source-filter.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/source-filter.js src/pipeline/steps/source-filter.test.js
git commit -m "feat(pipeline): add source-filter step (replaces allowed-types)"
```

---

## Task 4: Update NER step to use source aliases

**Files:**
- Modify: `src/pipeline/steps/ner.js`

- [ ] **Step 1: Update the NER test expectations (temporary — they will move in Task 7)**

Open `src/pipeline/steps/steps.test.js`. Find the `createNerStep` describe block at around line 226. Temporarily add a test that asserts alias is written. Add this new test inside the existing `describe('createNerStep', ...)` block, after the last existing test:

```js
  it('writes entity.source = alias (not raw HF id)', async () => {
    const mockLoadModel = async () => ({
      infer: async () => [
        { word: 'Jan', entity: 'B-PERSON_NAME', score: 0.9, index: 0 },
      ],
      dispose: async () => {},
    });

    const step = createNerStep(
      [{ alias: 'multilang-q8', id: 'bardsai/eu-pii-anonimization-multilang', dtype: 'q8' }],
      mockLoadModel,
    );
    const ctx = {
      text: 'Jan',
      segments: [{ text: 'Jan', offset: 0 }],
      entities: [],
      anonymized: '',
      legend: {},
    };
    const result = await step(ctx);
    expect(result.entities[0].source).toBe('multilang-q8');
  });
```

- [ ] **Step 2: Run test to verify fail**

Run: `npx vitest run src/pipeline/steps/steps.test.js -t "writes entity.source = alias"`
Expected: FAIL (source is still `id` or something else).

- [ ] **Step 3: Update `src/pipeline/steps/ner.js`**

Replace the file contents with:

```js
import { aggregateEntities } from '../../anonymizer.js';

/**
 * Factory that creates a NER pipeline step.
 *
 * @param {Array<{alias: string, id: string, dtype: string}>} sources - Active HF sources
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), dispose() }
 */
export function createNerStep(sources, loadModel) {
  return async function nerStep(ctx) {
    const allEntities = [];

    for (const source of sources) {
      const ner = await loadModel({ id: source.id, dtype: source.dtype });

      for (const segment of ctx.segments) {
        const raw = await ner.infer(segment.text);
        const chunkEntities = raw[0]?.entity_group
          ? raw
          : aggregateEntities(raw, segment.text);

        for (const entity of chunkEntities) {
          allEntities.push({
            ...entity,
            start: entity.start + segment.offset,
            end: entity.end + segment.offset,
            source: source.alias,
          });
        }
      }

      await ner.dispose();
    }

    return { ...ctx, entities: [...ctx.entities, ...allEntities] };
  };
}
```

- [ ] **Step 4: Update the other two existing `createNerStep` tests to use the new signature**

In `src/pipeline/steps/steps.test.js`, update the three pre-existing NER tests to pass `alias` in the source objects:

Change:
```js
const step = createNerStep([{ id: 'mock-model', dtype: 'q8' }], mockLoadModel);
```
to:
```js
const step = createNerStep([{ alias: 'mock', id: 'mock-model', dtype: 'q8' }], mockLoadModel);
```

And the two-source variant:
```js
const step = createNerStep(
  [{ id: 'model-a', dtype: 'q8' }, { id: 'model-b', dtype: 'q8' }],
  mockLoadModel,
);
```
to:
```js
const step = createNerStep(
  [{ alias: 'a', id: 'model-a', dtype: 'q8' }, { alias: 'b', id: 'model-b', dtype: 'q8' }],
  mockLoadModel,
);
```

- [ ] **Step 5: Run all NER tests to verify pass**

Run: `npx vitest run src/pipeline/steps/steps.test.js -t "createNerStep"`
Expected: all 4 NER tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/steps/ner.js src/pipeline/steps/steps.test.js
git commit -m "feat(ner): write entity.source as alias; accept {alias,id,dtype} sources"
```

---

## Task 5: Convert regex step to factory with active flag

**Files:**
- Modify: `src/pipeline/steps/regex.js`
- Modify: `src/pipeline/steps/steps.test.js`

- [ ] **Step 1: Add a failing test for the inactive branch**

In `src/pipeline/steps/steps.test.js`:
1. At the top of the file, replace the import line `import { regexStep } from './regex.js';` with `import { createRegexStep } from './regex.js';`.
2. Find the `describe('regexStep', ...)` block and replace it entirely with the block below (no nested import — the import lives at the top of the file):

```js
describe('createRegexStep', () => {
  it('adds regex-detected entities when active', () => {
    const text = 'Contact jan@test.com for details';
    const step = createRegexStep(true);
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 7, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = step(ctx);
    expect(result.entities.length).toBe(2);
    const email = result.entities.find(e => e.entity_group === 'EMAIL_ADDRESS');
    expect(email).toBeDefined();
    expect(email.score).toBe(1.0);
    expect(email.source).toBe('regex');
  });

  it('is a no-op when inactive', () => {
    const text = 'Contact jan@test.com for details';
    const step = createRegexStep(false);
    const ctx = {
      text,
      segments: [],
      entities: [
        { entity_group: 'PERSON_NAME', start: 0, end: 7, score: 0.9, source: 'multilang-q8' },
      ],
      anonymized: '',
      legend: {},
    };
    const result = step(ctx);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity_group).toBe('PERSON_NAME');
  });
});
```

The old `regexStep` symbol must no longer be referenced anywhere in the file.

- [ ] **Step 2: Run tests to verify fail**

Run: `npx vitest run src/pipeline/steps/steps.test.js -t "createRegexStep"`
Expected: FAIL — `createRegexStep` is not exported.

- [ ] **Step 3: Update `src/pipeline/steps/regex.js`**

Replace the file contents with:

```js
import { findRegexEntities } from '../../anonymizer.js';

export function createRegexStep(active) {
  return function regexStep(ctx) {
    if (!active) return ctx;
    const regexEntities = findRegexEntities(ctx.text);
    return { ...ctx, entities: [...ctx.entities, ...regexEntities] };
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/pipeline/steps/steps.test.js -t "createRegexStep"`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps/regex.js src/pipeline/steps/steps.test.js
git commit -m "refactor(regex): convert regex step to factory with active flag"
```

---

## Task 6: Delete `allowed-types.js` and wire new steps into `default.js`

**Files:**
- Modify: `src/pipeline/configs/default.js`
- Delete: `src/pipeline/steps/allowed-types.js`
- Modify: `src/pipeline/steps/steps.test.js`

- [ ] **Step 1: Remove the `allowedTypesStep` tests**

In `src/pipeline/steps/steps.test.js`:
- Remove the `import { allowedTypesStep } from './allowed-types.js';` line.
- Remove the entire `describe('allowedTypesStep', ...)` block.

- [ ] **Step 2: Rewrite `src/pipeline/configs/default.js`**

Replace the file contents with:

```js
import { normalizeWhitespace } from '../steps/preprocess.js';
import { createSentencexSegmentStep } from '../steps/segment-sentencex.js';
import { mergeAbbreviationsStep } from '../steps/merge-abbreviations.js';
import { createNerStep } from '../steps/ner.js';
import { createRegexStep } from '../steps/regex.js';
import { createSourceFilterStep } from '../steps/source-filter.js';
import { snapStep } from '../steps/snap.js';
import { trimTrailingDotStep } from '../steps/trim-trailing-dot.js';
import { filterStep } from '../steps/filter.js';
import { dedupStep } from '../steps/dedup.js';
import { mergeStep } from '../steps/merge.js';
import { rescanStep } from '../steps/rescan.js';
import { tokenizeStep } from '../steps/tokenize.js';
import { ENTITY_SOURCES, SOURCES, requiredSources } from './entity-sources.js';

// Resolve the user's selection into concrete active sources for the pipeline.
function resolveActiveSources({ enabledEntities, entitySources, sources }) {
  const needed = requiredSources(enabledEntities);
  const hf = [];
  let regexActive = false;
  for (const alias of needed) {
    const def = sources[alias];
    if (!def) continue;
    if (def.kind === 'hf') hf.push({ alias, id: def.id, dtype: def.dtype });
    else if (def.kind === 'regex') regexActive = true;
  }
  return { hf, regexActive };
}

/**
 * Creates the default PII anonymization pipeline.
 *
 * @param {Function} loadModel - async ({id, dtype}) => { infer(text), dispose() }
 * @param {Function} getSentenceBoundaries - (lang, text) => [{start_index, end_index, text}, ...]
 * @param {object} options - { enabledEntities, entitySources?, sources? }
 */
export function createDefaultPipeline(loadModel, getSentenceBoundaries, options) {
  const entitySources = options.entitySources ?? ENTITY_SOURCES;
  const sources = options.sources ?? SOURCES;
  const enabledEntities = options.enabledEntities;
  const { hf, regexActive } = resolveActiveSources({ enabledEntities, entitySources, sources });

  return [
    { phase: 'preprocess', steps: [normalizeWhitespace] },
    { phase: 'segment', steps: [
      createSentencexSegmentStep(getSentenceBoundaries),
      mergeAbbreviationsStep,
    ] },
    { phase: 'ner', steps: [createNerStep(hf, loadModel), createRegexStep(regexActive)] },
    { phase: 'postprocess', steps: [
      createSourceFilterStep({ enabledEntities, entitySources }),
      snapStep,
      trimTrailingDotStep,
      filterStep,
      dedupStep,
      mergeStep,
      tokenizeStep,
      rescanStep,
    ] },
  ];
}
```

- [ ] **Step 3: Delete `src/pipeline/steps/allowed-types.js`**

Run: `rm src/pipeline/steps/allowed-types.js`

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (no import errors, no regressions).

- [ ] **Step 5: Commit**

```bash
git add -A src/pipeline
git commit -m "refactor(pipeline): wire source-filter/regex factories; drop allowed-types"
```

---

## Task 7: Rewrite worker with `configure`/`classify` protocol

**Files:**
- Modify: `src/worker.js`

- [ ] **Step 1: Replace `src/worker.js` contents**

```js
import { pipeline as hfPipeline } from '@huggingface/transformers';
import init, { get_sentence_boundaries } from 'sentencex-wasm';
import sentencexWasm from 'sentencex-wasm/sentencex_wasm_bg.wasm?url';
import { runPipeline } from './pipeline/runner.js';
import { createDefaultPipeline } from './pipeline/configs/default.js';
import { SOURCES, ENTITY_SOURCES, requiredSources } from './pipeline/configs/entity-sources.js';

let wasmReady = false;
let currentConfig = null;        // { enabledEntities, requiredAliases: string[] }
const loadedModels = new Map();  // alias -> { ner, dispose }

async function ensureWasm() {
  if (!wasmReady) {
    await init(sentencexWasm);
    wasmReady = true;
  }
}

async function disposeModel(alias) {
  const entry = loadedModels.get(alias);
  if (!entry) return;
  try { await entry.dispose(); } catch (err) { console.warn(`[worker] dispose ${alias}:`, err); }
  loadedModels.delete(alias);
}

async function disposeUnusedModels(neededAliases) {
  const keep = new Set(neededAliases);
  for (const alias of [...loadedModels.keys()]) {
    if (!keep.has(alias)) await disposeModel(alias);
  }
}

async function ensureModelLoaded(alias) {
  if (loadedModels.has(alias)) return;
  const def = SOURCES[alias];
  if (!def || def.kind !== 'hf') return;
  const ner = await hfPipeline('token-classification', def.id, {
    dtype: def.dtype,
    progress_callback: (data) => {
      if (data.status === 'progress') {
        self.postMessage({ type: 'progress', file: data.file, progress: data.progress });
      }
    },
  });
  loadedModels.set(alias, { ner, dispose: async () => await ner.dispose() });
  console.log(`[worker] loaded ${alias} (${def.id}, ${def.dtype})`);
}

async function loadModelForPipeline({ id, dtype }) {
  // Look up alias by {id, dtype} to reuse the cached NER pipeline.
  const alias = Object.keys(SOURCES).find((k) => {
    const s = SOURCES[k];
    return s.kind === 'hf' && s.id === id && s.dtype === dtype;
  });
  if (!alias) throw new Error(`[worker] unknown model ${id}@${dtype}`);
  await ensureModelLoaded(alias);
  const entry = loadedModels.get(alias);
  return {
    infer: async (text) => await entry.ner(text),
    // Do NOT dispose here — worker owns the cache lifecycle.
    dispose: async () => {},
  };
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'configure') {
    try {
      await ensureWasm();
      const enabledEntities = e.data.enabledEntities ?? [];
      const requiredAliases = requiredSources(enabledEntities).filter((a) => SOURCES[a]?.kind === 'hf');
      currentConfig = { enabledEntities, requiredAliases };
      await disposeUnusedModels(requiredAliases);
      self.postMessage({ type: 'configured', requiredAliases });
    } catch (err) {
      console.error('[worker] configure failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (type === 'classify') {
    if (!currentConfig) {
      self.postMessage({ type: 'error', message: 'Worker not configured' });
      return;
    }
    if (currentConfig.enabledEntities.length === 0) {
      self.postMessage({ type: 'error', message: 'No entities enabled' });
      return;
    }
    try {
      for (const alias of currentConfig.requiredAliases) {
        await ensureModelLoaded(alias);
      }
      const pipelineConfig = createDefaultPipeline(
        loadModelForPipeline,
        get_sentence_boundaries,
        { enabledEntities: currentConfig.enabledEntities, entitySources: ENTITY_SOURCES, sources: SOURCES },
      );
      const ctx = await runPipeline(e.data.text, pipelineConfig);
      self.postMessage({
        type: 'result',
        data: ctx.entities,
        anonymized: ctx.anonymized,
        legend: ctx.legend,
        debug: ctx.debug,
      });
    } catch (err) {
      console.error('[worker] classify failed:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }
};
```

- [ ] **Step 2: Run full test suite (no worker tests, just sanity)**

Run: `npm test`
Expected: all tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add src/worker.js
git commit -m "feat(worker): configure/classify protocol with per-alias model cache"
```

---

## Task 8: Add `entity-selector.js` UI module

**Files:**
- Create: `src/ui/entity-selector.js`

- [ ] **Step 1: Create the module**

Create `src/ui/entity-selector.js`:

```js
// Renders a grouped entity picker. Category checkbox is tri-state (derived from children).
// onChange is called (debounced by the caller, not here) with the current enabled list.
export function createEntitySelector(container, { categories, labels, initial, onChange }) {
  const state = new Set(initial);
  const perEntityInputs = new Map();   // entity -> HTMLInputElement
  const perCategoryInputs = new Map(); // categoryId -> HTMLInputElement

  container.innerHTML = '';
  container.classList.add('entity-selector');

  for (const cat of categories) {
    const fs = document.createElement('fieldset');
    fs.className = 'entity-category';
    fs.dataset.categoryId = cat.id;

    const legend = document.createElement('legend');
    const catLabel = document.createElement('label');
    catLabel.className = 'entity-category-label';
    const catInput = document.createElement('input');
    catInput.type = 'checkbox';
    catInput.addEventListener('change', () => {
      const turnOn = catInput.checked;
      for (const entity of cat.entities) {
        if (turnOn) state.add(entity);
        else state.delete(entity);
        const input = perEntityInputs.get(entity);
        if (input) input.checked = turnOn;
      }
      refreshCategoryState(cat.id);
      emit();
    });
    perCategoryInputs.set(cat.id, catInput);

    const catCount = document.createElement('span');
    catCount.className = 'entity-category-count';

    catLabel.appendChild(catInput);
    catLabel.append(` ${cat.label} `);
    catLabel.appendChild(catCount);
    legend.appendChild(catLabel);
    fs.appendChild(legend);

    const list = document.createElement('div');
    list.className = 'entity-category-list';
    for (const entity of cat.entities) {
      const row = document.createElement('label');
      row.className = 'entity-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.has(entity);
      input.dataset.entity = entity;
      input.addEventListener('change', () => {
        if (input.checked) state.add(entity);
        else state.delete(entity);
        refreshCategoryState(cat.id);
        emit();
      });
      perEntityInputs.set(entity, input);

      row.appendChild(input);
      row.append(` ${labels[entity] ?? entity} `);
      const code = document.createElement('code');
      code.textContent = entity;
      row.appendChild(code);
      list.appendChild(row);
    }
    fs.appendChild(list);
    container.appendChild(fs);

    refreshCategoryState(cat.id);
  }

  function refreshCategoryState(categoryId) {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    const total = cat.entities.length;
    const checked = cat.entities.filter((e) => state.has(e)).length;
    const input = perCategoryInputs.get(categoryId);
    input.checked = checked === total;
    input.indeterminate = checked > 0 && checked < total;
    const countEl = container
      .querySelector(`.entity-category[data-category-id="${categoryId}"] .entity-category-count`);
    if (countEl) countEl.textContent = `(${checked}/${total})`;
  }

  let suppress = false;
  function emit() {
    if (suppress) return;
    onChange([...state]);
  }

  return {
    getSelected() { return [...state]; },
    setSelected(entities) {
      suppress = true;
      state.clear();
      for (const e of entities) state.add(e);
      for (const [entity, input] of perEntityInputs) input.checked = state.has(entity);
      for (const cat of categories) refreshCategoryState(cat.id);
      suppress = false;
    },
    destroy() {
      container.innerHTML = '';
      container.classList.remove('entity-selector');
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/entity-selector.js
git commit -m "feat(ui): add entity-selector with tri-state categories"
```

---

## Task 9: Update `index.html` — add selector section, drop download button

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace contents**

Open `index.html`. Replace the existing `<section id="model-section">` and `<section id="input-section">` with the following block (keep everything else in the file untouched):

```html
    <section id="entity-selector-section">
      <label>1. Wybierz dane do anonimizacji</label>
      <div id="entity-selector-root"></div>
    </section>

    <section id="input-section">
      <label for="input-text">2. Wklej swój dokument</label>
      <textarea id="input-text" rows="10" placeholder="Wklej tekst zawierający dane osobowe..."></textarea>
      <button id="anonymize-btn" class="btn btn-primary" disabled>Anonimizuj</button>
      <p id="model-status"></p>
    </section>
```

Note: the second-step textarea `<label for="deanonymize-input">2. Wklej odpowiedź LLM...</label>` should also be renumbered to `3.` — update that line accordingly.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(ui): replace download button with entity selector section"
```

---

## Task 10: Update `src/main.js` — integrate selector + new worker protocol

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Replace `src/main.js` contents**

```js
import { deanonymizeText } from './anonymizer.js';
import { createEntitySelector } from './ui/entity-selector.js';
import {
  ENTITY_CATEGORIES,
  ENTITY_LABELS,
  defaultEnabledEntities,
} from './pipeline/configs/entity-sources.js';
import './style.css';

const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
});

let currentLegend = null;
let configuredOnce = false;
let classifyInFlight = false;
const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';
const LS_KEY = 'pii.selected-entities';

// --- DOM refs ---
const modelStatus = document.getElementById('model-status');
const inputText = document.getElementById('input-text');
const anonymizeBtn = document.getElementById('anonymize-btn');
const resultSection = document.getElementById('result-section');
const anonymizedOutput = document.getElementById('anonymized-output');
const copyAnonymizedBtn = document.getElementById('copy-anonymized');
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

// --- Restore or default selection ---
function loadSelectionFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((e) => typeof e === 'string');
  } catch {
    return null;
  }
}

const initialSelection = loadSelectionFromStorage() ?? defaultEnabledEntities();

// --- Debounced configure ---
let configureTimer = null;
function scheduleConfigure(enabledEntities) {
  clearTimeout(configureTimer);
  configureTimer = setTimeout(() => {
    worker.postMessage({ type: 'configure', enabledEntities });
  }, 300);
}

const selector = createEntitySelector(selectorRoot, {
  categories: ENTITY_CATEGORIES,
  labels: ENTITY_LABELS,
  initial: initialSelection,
  onChange(selected) {
    localStorage.setItem(LS_KEY, JSON.stringify(selected));
    updateAnonymizeButton();
    scheduleConfigure(selected);
  },
});

// Initial configure (no debounce).
worker.postMessage({ type: 'configure', enabledEntities: selector.getSelected() });

function updateAnonymizeButton() {
  const hasSelection = selector.getSelected().length > 0;
  anonymizeBtn.disabled = !hasSelection || !configuredOnce || classifyInFlight;
  if (!hasSelection) {
    modelStatus.textContent = 'Wybierz przynajmniej jedną encję.';
  } else if (!classifyInFlight) {
    modelStatus.textContent = '';
  }
}

// --- Worker message handler ---
worker.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'progress': {
      const pct = Math.round(msg.progress ?? 0);
      modelStatus.textContent = `Pobieranie modelu ${msg.file ?? ''}... ${pct}%`;
      break;
    }
    case 'configured':
      configuredOnce = true;
      updateAnonymizeButton();
      break;
    case 'result':
      classifyInFlight = false;
      handleAnonymizationResult(msg);
      updateAnonymizeButton();
      break;
    case 'error':
      classifyInFlight = false;
      modelStatus.textContent = `Błąd: ${msg.message}`;
      anonymizeBtn.textContent = 'Anonimizuj';
      updateAnonymizeButton();
      break;
  }
};

// --- Anonymize ---
anonymizeBtn.addEventListener('click', () => {
  const text = inputText.value.trim();
  if (!text) return;
  classifyInFlight = true;
  modelStatus.textContent = 'Analizowanie...';
  anonymizeBtn.textContent = 'Analizowanie...';
  anonymizeBtn.disabled = true;
  worker.postMessage({ type: 'classify', text });
});

function handleAnonymizationResult(msg) {
  const { anonymized, legend, debug } = msg;
  currentLegend = legend;

  anonymizedOutput.textContent = anonymized;

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
  deanonymizeSection.hidden = false;
  deanonymizeResultSection.hidden = true;
  anonymizeBtn.textContent = 'Anonimizuj';

  if (isDebug && debug) {
    renderDebugPanel(debug, anonymized, legend);
    debugSection.hidden = false;
  }
}

// --- Debug panel (unchanged) ---
function renderDebugPanel(debug, anonymized, legend) {
  debugPanel.innerHTML = '';

  for (const entry of debug) {
    const card = document.createElement('details');
    card.className = 'debug-step';

    const summary = document.createElement('summary');
    const c = entry.changes;
    const parts = [`<strong>${entry.step}</strong> <span class="debug-phase">${entry.phase}</span>`];

    if (c.segments) parts.push(`segmenty +${c.segments.added.length}`);
    if (c.entities) {
      const { added, removed, count } = c.entities;
      const bits = [];
      if (added.length) bits.push(`+${added.length}`);
      if (removed.length) bits.push(`-${removed.length}`);
      bits.push(`(${count.before}\u2192${count.after})`);
      parts.push(`encje ${bits.join(' ')}`);
    }
    if (c.anonymized) parts.push('tekst zanonimizowany zmieniony');
    if (c.legend) parts.push(`legenda +${Object.keys(c.legend.added).length}`);
    if (c.text) parts.push('tekst zmieniony');
    if (Object.keys(c).length === 0) parts.push('<em>brak zmian</em>');

    summary.innerHTML = parts.join(' &middot; ');
    card.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'debug-step-body';

    if (c.entities) {
      if (c.entities.added.length > 0) {
        body.appendChild(makeEntityTable('Dodane', c.entities.added));
      }
      if (c.entities.removed.length > 0) {
        body.appendChild(makeEntityTable('Usunięte', c.entities.removed));
      }
    }

    if (c.segments) {
      const h = document.createElement('h5');
      h.textContent = `Segmenty (${c.segments.count.after})`;
      body.appendChild(h);
      const ul = document.createElement('ul');
      for (const seg of c.segments.added) {
        const li = document.createElement('li');
        li.textContent = `offset ${seg.offset}, ${seg.length} znaków: "${seg.preview}..."`;
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    if (c.legend) {
      const h = document.createElement('h5');
      h.textContent = `Legenda (+${Object.keys(c.legend.added).length})`;
      body.appendChild(h);
      const table = document.createElement('table');
      table.className = 'debug-table';
      for (const [token, value] of Object.entries(c.legend.added)) {
        const row = document.createElement('tr');
        row.innerHTML = `<td><code>${escHtml(token)}</code></td><td>${escHtml(value)}</td>`;
        table.appendChild(row);
      }
      body.appendChild(table);
    }

    card.appendChild(body);
    debugPanel.appendChild(card);
  }

  let copyBtn = document.getElementById('copy-debug-json');
  if (!copyBtn) {
    copyBtn = document.createElement('button');
    copyBtn.id = 'copy-debug-json';
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = 'Kopiuj JSON debug';
    copyBtn.style.marginTop = '0.5rem';
    debugPanel.appendChild(copyBtn);
  }
  copyBtn.onclick = () => {
    const output = { anonymized, legend, debug };
    navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    copyBtn.textContent = 'Skopiowano!';
    setTimeout(() => { copyBtn.textContent = 'Kopiuj JSON debug'; }, 2000);
  };
}

function makeEntityTable(label, entities) {
  const h = document.createElement('h5');
  h.textContent = `${label} (${entities.length})`;
  const table = document.createElement('table');
  table.className = 'debug-table';
  const thead = document.createElement('tr');
  thead.innerHTML = '<th>Typ</th><th>Tekst</th><th>Zakres</th><th>Pewność</th><th>Źródło</th>';
  table.appendChild(thead);
  for (const e of entities) {
    const row = document.createElement('tr');
    const src = Array.isArray(e.source) ? e.source.join(', ') : (e.source ?? '');
    row.innerHTML = `<td>${escHtml(e.entity_group)}</td><td>${escHtml(e.text)}</td><td>${e.start}-${e.end}</td><td>${e.score?.toFixed(3) ?? ''}</td><td>${escHtml(src)}</td>`;
    table.appendChild(row);
  }
  const frag = document.createDocumentFragment();
  frag.appendChild(h);
  frag.appendChild(table);
  return frag;
}

function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// --- Copy anonymized ---
copyAnonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(anonymizedOutput.textContent);
  copyAnonymizedBtn.textContent = 'Skopiowano!';
  setTimeout(() => { copyAnonymizedBtn.textContent = 'Kopiuj do schowka'; }, 2000);
});

// --- De-anonymize ---
deanonymizeBtn.addEventListener('click', () => {
  const text = deanonymizeInput.value.trim();
  if (!text || !currentLegend) return;
  const result = deanonymizeText(text, currentLegend);
  deanonymizedOutput.textContent = result;
  deanonymizeResultSection.hidden = false;
});

copyDeanonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(deanonymizedOutput.textContent);
  copyDeanonymizedBtn.textContent = 'Skopiowano!';
  setTimeout(() => { copyDeanonymizedBtn.textContent = 'Kopiuj do schowka'; }, 2000);
});

updateAnonymizeButton();
```

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "feat(ui): integrate entity selector with configure/classify worker"
```

---

## Task 11: Add selector styles

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Append styles to `src/style.css`**

Append these rules at the end of the file:

```css
.entity-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.entity-selector .entity-category {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin: 0;
}

.entity-selector .entity-category legend {
  padding: 0 0.25rem;
  font-weight: 600;
}

.entity-selector .entity-category-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}

.entity-selector .entity-category-count {
  color: #666;
  font-weight: 400;
  font-size: 0.9em;
}

.entity-selector .entity-category-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.25rem;
}

.entity-selector .entity-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95em;
  cursor: pointer;
}

.entity-selector .entity-row code {
  color: #888;
  font-size: 0.85em;
}

@media (max-width: 640px) {
  .entity-selector {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/style.css
git commit -m "style(ui): add entity selector styles"
```

---

## Task 12: Update eval CLI

**Files:**
- Modify: `src/eval/run.js`

- [ ] **Step 1: Patch imports and config usage**

Open `src/eval/run.js`. Replace the import at line 6:

```js
import { createDefaultPipeline } from '../pipeline/configs/default.js';
```

with:

```js
import { createDefaultPipeline } from '../pipeline/configs/default.js';
import { ENTITY_SOURCES, SOURCES, allEntityTypes } from '../pipeline/configs/entity-sources.js';
```

- [ ] **Step 2: Parse `--entities` and pass config to the pipeline**

Replace the `main()` function body up to the "Build summary" block. Find the line:

```js
const pipelineConfig = createDefaultPipeline(loadModelNode, get_sentence_boundaries);
```

and replace it with:

```js
const entitiesArg = args.find(a => a.startsWith('--entities='))?.slice('--entities='.length);
let enabledEntities;
if (entitiesArg) {
  const requested = entitiesArg.split(',').map(s => s.trim()).filter(Boolean);
  const known = new Set(allEntityTypes());
  const unknown = requested.filter(e => !known.has(e));
  if (unknown.length > 0) {
    console.error(`Unknown entity types: ${unknown.join(', ')}`);
    console.error(`Valid: ${[...known].sort().join(', ')}`);
    process.exit(1);
  }
  enabledEntities = requested;
} else {
  enabledEntities = allEntityTypes();
}

console.log(`Entities: ${enabledEntities.length === allEntityTypes().length ? 'all' : enabledEntities.join(', ')}`);

const pipelineConfig = createDefaultPipeline(
  loadModelNode,
  get_sentence_boundaries,
  { enabledEntities, entitySources: ENTITY_SOURCES, sources: SOURCES },
);
```

- [ ] **Step 3: Record `enabledEntities` in the summary**

Find the `summary` object definition and add `enabledEntities` to it:

```js
const summary = {
  runId,
  timestamp: new Date().toISOString(),
  ...(label && { label }),
  enabledEntities,
  totals: {
    documents: results.length,
    entities: totalEntities,
    tokens: totalTokens,
    elapsed: totalElapsed.toFixed(2),
  },
  documents,
};
```

- [ ] **Step 4: Quick sanity run — validation path**

Run: `npm run eval -- --entities=NOT_REAL`
Expected: prints "Unknown entity types: NOT_REAL" and exits non-zero.

- [ ] **Step 5: Commit**

```bash
git add src/eval/run.js
git commit -m "feat(eval): --entities flag; default covers all entity types"
```

---

## Task 13: Manual verification

**Files:** n/a

- [ ] **Step 1: Build passes**

Run: `npm run build`
Expected: completes without errors; output in `dist/`.

- [ ] **Step 2: Full unit test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 3: Dev server smoke test**

Run: `npm run dev` and open the URL in a browser. Verify:
- Entity selector renders 7 categories; categories 1–5 are checked by default, categories 6–7 unchecked (or matches localStorage if previously set).
- Category checkboxes are tri-state: uncheck one entity in "Personal Identity" → category shows `indeterminate`.
- Click "Anonimizuj" on sample text (e.g. "Jan Kowalski, tel. +48 600 123 456, jan@example.com") → first click shows "Pobieranie modelu ... %", then result appears.
- Click "Anonimizuj" again on the same text → no download progress, just "Analizowanie..." then result.
- Uncheck all entities → button disabled, status reads "Wybierz przynajmniej jedną encję.".
- Reload page → selection persisted.
- Toggle on "Health & Biometric" (both models already cached) → classify runs without new download.
- Append `?debug=1` to the URL → debug panel shows alias values in the "Źródło" column (e.g. `multilang-q8`, `regex`).

- [ ] **Step 4: Eval baseline**

Run: `npm run eval -- --label=entity-sources-baseline`
Expected: completes; `test-data/results/<timestamp>/summary.json` contains `enabledEntities: [all 35 types]`.

- [ ] **Step 5: Eval subset**

Run: `npm run eval -- --label=entity-sources-subset --entities=PERSON_NAME,EMAIL_ADDRESS,PHONE_NUMBER`
Expected: completes; per-document `entities.json` contains only those three entity types.

- [ ] **Step 6: Compare vs prior baseline**

Run: `npm run eval:compare -- latest <prior-baseline-id>` (substitute the prior full-run id from `npm run eval:list`)
Expected: no large regressions on counts (accept small drift from step reshuffling).

- [ ] **Step 7: Final commit (if any tweaks were needed)**

If any of steps 3–6 surfaced fixable issues, make the fix and commit with an appropriate message. Otherwise skip.

---
