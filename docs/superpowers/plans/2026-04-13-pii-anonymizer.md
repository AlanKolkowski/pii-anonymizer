# PII Anonymizer — One-Pager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page browser app that anonymizes PII using the `bardsai/eu-pii-anonimization-multilang` model via Web Worker, lets users copy anonymized text for LLM work, then de-anonymize the LLM output.

**Architecture:** Vanilla JS + Vite. The NER model runs in a Web Worker (via `@huggingface/transformers`) to avoid blocking the UI. Pure functions handle token mapping and text replacement. No framework — just HTML, CSS, JS.

**Tech Stack:** Vite, `@huggingface/transformers`, vitest

---

## File Structure

```
pii/
├── index.html              # Page structure — all UI sections
├── package.json            # Deps: @huggingface/transformers, vite, vitest
├── vite.config.js          # Minimal — defaults are fine
├── src/
│   ├── main.js             # DOM events, worker communication, UI state
│   ├── worker.js           # Web Worker: model load + NER inference
│   ├── anonymizer.js       # Pure functions: buildTokenMap, anonymizeText, deanonymizeText
│   ├── anonymizer.test.js  # Unit tests for anonymizer
│   └── style.css           # Styling
```

**Responsibilities:**
- `worker.js` — only does model I/O. Receives `load` and `classify` messages, sends back `progress`, `loaded`, `result`, `error`.
- `anonymizer.js` — pure functions, no DOM, no side effects. All token-mapping and text-replacement logic lives here.
- `main.js` — glue. Wires DOM events to worker messages and anonymizer functions. Manages UI state (show/hide sections, button states).
- `index.html` — semantic HTML with all sections. Sections hidden by default get revealed by JS.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html` (shell)
- Create: `src/main.js` (empty)
- Create: `src/style.css` (empty)

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/wjarka/code/pii
cat > package.json << 'PKGJSON'
{
  "name": "pii-anonymizer",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@huggingface/transformers": "^3.4.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
PKGJSON
```

- [ ] **Step 2: Create vite.config.js**

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 3: Create index.html shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PII Anonymizer</title>
  <link rel="stylesheet" href="/src/style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>PII Anonymizer</h1>
      <p>Anonymize personal data locally in your browser. No data leaves your device.</p>
    </header>
  </div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create empty src files**

```bash
mkdir -p src
touch src/main.js src/style.css
```

- [ ] **Step 5: Install dependencies and verify dev server**

```bash
npm install
npx vite --port 3000 &
# Open http://localhost:3000 in browser, verify page loads with "PII Anonymizer" heading
# Then kill the dev server
kill %1
```

- [ ] **Step 6: Commit**

```bash
git init
echo "node_modules\ndist" > .gitignore
git add .gitignore package.json package-lock.json vite.config.js index.html src/main.js src/style.css
git commit -m "chore: scaffold project with vite"
```

---

## Task 2: Anonymization Logic — Tests

**Files:**
- Create: `src/anonymizer.js` (exports only)
- Create: `src/anonymizer.test.js`

- [ ] **Step 1: Create anonymizer.js with empty exports**

```javascript
// src/anonymizer.js

export function buildTokenMap(entities, originalText) {
  throw new Error('Not implemented');
}

export function anonymizeText(text, entities) {
  throw new Error('Not implemented');
}

export function deanonymizeText(text, legend) {
  throw new Error('Not implemented');
}
```

- [ ] **Step 2: Write tests for buildTokenMap**

```javascript
// src/anonymizer.test.js
import { describe, it, expect } from 'vitest';
import { buildTokenMap, anonymizeText, deanonymizeText } from './anonymizer.js';

describe('buildTokenMap', () => {
  it('assigns indexed tokens per entity type', () => {
    const text = 'Jan Kowalski and Anna Nowak';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 18, end: 27, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[PERSON_NAME_2]': 'Anna Nowak',
    });
  });

  it('reuses token when same value repeats', () => {
    const text = 'Jan Kowalski called Jan Kowalski';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 20, end: 33, score: 0.97 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
    });
  });

  it('handles multiple entity types independently', () => {
    const text = 'Jan Kowalski, email jan@test.com';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.98 },
      { entity_group: 'EMAIL_ADDRESS', start: 20, end: 32, score: 0.99 },
    ];
    const { legend } = buildTokenMap(entities, text);
    expect(legend).toEqual({
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[EMAIL_ADDRESS_1]': 'jan@test.com',
    });
  });

  it('returns empty legend for no entities', () => {
    const { legend } = buildTokenMap([], 'no PII');
    expect(legend).toEqual({});
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run
```

Expected: 4 failures — `Not implemented`.

- [ ] **Step 4: Write tests for anonymizeText**

Append to `src/anonymizer.test.js`:

```javascript
describe('anonymizeText', () => {
  it('replaces entities with indexed tokens', () => {
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.98 },
      { entity_group: 'ORGANIZATION_NAME', start: 23, end: 35, score: 0.95 },
    ];
    const { anonymized, legend } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]');
    expect(legend['[PERSON_NAME_1]']).toBe('Jan Kowalski');
    expect(legend['[ORGANIZATION_NAME_1]']).toBe('Example Corp');
  });

  it('uses same token for duplicate entity values', () => {
    const text = 'Jan Kowalski called Jan Kowalski';
    const entities = [
      { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.98 },
      { entity_group: 'PERSON_NAME', start: 20, end: 33, score: 0.97 },
    ];
    const { anonymized } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] called [PERSON_NAME_1]');
  });

  it('handles entities not sorted by position', () => {
    const text = 'Jan Kowalski works at Example Corp';
    const entities = [
      { entity_group: 'ORGANIZATION_NAME', start: 23, end: 35, score: 0.95 },
      { entity_group: 'PERSON_NAME', start: 0, end: 13, score: 0.98 },
    ];
    const { anonymized } = anonymizeText(text, entities);
    expect(anonymized).toBe('[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]');
  });

  it('returns unchanged text when no entities', () => {
    const { anonymized, legend } = anonymizeText('No PII here', []);
    expect(anonymized).toBe('No PII here');
    expect(legend).toEqual({});
  });
});
```

- [ ] **Step 5: Write tests for deanonymizeText**

Append to `src/anonymizer.test.js`:

```javascript
describe('deanonymizeText', () => {
  it('replaces tokens with original values', () => {
    const text = '[PERSON_NAME_1] works at [ORGANIZATION_NAME_1]';
    const legend = {
      '[PERSON_NAME_1]': 'Jan Kowalski',
      '[ORGANIZATION_NAME_1]': 'Example Corp',
    };
    expect(deanonymizeText(text, legend)).toBe('Jan Kowalski works at Example Corp');
  });

  it('replaces multiple occurrences of same token', () => {
    const text = '[PERSON_NAME_1] called [PERSON_NAME_1]';
    const legend = { '[PERSON_NAME_1]': 'Jan Kowalski' };
    expect(deanonymizeText(text, legend)).toBe('Jan Kowalski called Jan Kowalski');
  });

  it('leaves text unchanged when no tokens match', () => {
    expect(deanonymizeText('no tokens', { '[X_1]': 'val' })).toBe('no tokens');
  });

  it('handles empty legend', () => {
    expect(deanonymizeText('some text', {})).toBe('some text');
  });
});
```

- [ ] **Step 6: Run tests to confirm all fail**

```bash
npx vitest run
```

Expected: all tests fail with `Not implemented`.

- [ ] **Step 7: Commit test file**

```bash
git add src/anonymizer.js src/anonymizer.test.js
git commit -m "test: add failing tests for anonymizer functions"
```

---

## Task 3: Anonymization Logic — Implementation

**Files:**
- Modify: `src/anonymizer.js`

- [ ] **Step 1: Implement buildTokenMap**

Replace the `buildTokenMap` function in `src/anonymizer.js`:

```javascript
export function buildTokenMap(entities, originalText) {
  const counters = {};
  const seen = {};
  const legend = {};

  for (const entity of entities) {
    const value = originalText.slice(entity.start, entity.end);
    const type = entity.entity_group;
    const key = `${type}::${value}`;

    if (!seen[key]) {
      counters[type] = (counters[type] || 0) + 1;
      const token = `[${type}_${counters[type]}]`;
      seen[key] = token;
      legend[token] = value;
    }
  }

  return { seen, legend };
}
```

- [ ] **Step 2: Run buildTokenMap tests**

```bash
npx vitest run -t "buildTokenMap"
```

Expected: 4 PASS.

- [ ] **Step 3: Implement anonymizeText**

Replace the `anonymizeText` function in `src/anonymizer.js`:

```javascript
export function anonymizeText(text, entities) {
  const { seen, legend } = buildTokenMap(entities, text);

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

  return { anonymized: result, legend };
}
```

- [ ] **Step 4: Run anonymizeText tests**

```bash
npx vitest run -t "anonymizeText"
```

Expected: 4 PASS.

- [ ] **Step 5: Implement deanonymizeText**

Replace the `deanonymizeText` function in `src/anonymizer.js`:

```javascript
export function deanonymizeText(text, legend) {
  let result = text;
  for (const [token, value] of Object.entries(legend)) {
    result = result.replaceAll(token, value);
  }
  return result;
}
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: all 12 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/anonymizer.js
git commit -m "feat: implement anonymize/deanonymize logic"
```

---

## Task 4: Web Worker

**Files:**
- Create: `src/worker.js`

- [ ] **Step 1: Create worker.js**

```javascript
// src/worker.js
import { pipeline } from '@huggingface/transformers';

let ner = null;

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      ner = await pipeline(
        'token-classification',
        'bardsai/eu-pii-anonimization-multilang',
        {
          dtype: 'q8',
          progress_callback: (data) => {
            if (data.status === 'progress') {
              self.postMessage({
                type: 'progress',
                file: data.file,
                progress: data.progress,
              });
            }
          },
        },
      );
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'classify') {
    if (!ner) {
      self.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }
    try {
      const results = await ner(e.data.text, {
        aggregation_strategy: 'simple',
      });
      self.postMessage({ type: 'result', data: results });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/worker.js
git commit -m "feat: add web worker for NER inference"
```

---

## Task 5: HTML Structure

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Write complete HTML**

Replace `index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PII Anonymizer</title>
  <link rel="stylesheet" href="/src/style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>PII Anonymizer</h1>
      <p class="subtitle">
        Anonymize personal data locally in your browser using
        <a href="https://huggingface.co/bardsai/eu-pii-anonimization-multilang" target="_blank" rel="noopener">bardsai/eu-pii-anonimization-multilang</a>.
        No data leaves your device.
      </p>
    </header>

    <section id="model-section">
      <button id="download-btn" class="btn btn-primary">Download Model (~110 MB)</button>
      <p id="model-status"></p>
    </section>

    <section id="input-section">
      <label for="input-text">1. Paste your document</label>
      <textarea id="input-text" rows="10" placeholder="Paste text containing personal data..."></textarea>
      <button id="anonymize-btn" class="btn btn-primary" disabled>Anonymize</button>
    </section>

    <section id="result-section" hidden>
      <h2>Anonymized Text</h2>
      <div class="output-wrapper">
        <pre id="anonymized-output" class="output-box"></pre>
        <button id="copy-anonymized" class="btn btn-secondary">Copy to Clipboard</button>
      </div>

      <h3>Legend</h3>
      <table id="legend-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Original Value</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>

    <section id="deanonymize-section" hidden>
      <label for="deanonymize-input">2. Paste LLM output containing tokens</label>
      <textarea id="deanonymize-input" rows="10" placeholder="Paste text with [PERSON_NAME_1] style tokens..."></textarea>
      <button id="deanonymize-btn" class="btn btn-primary">De-anonymize</button>
    </section>

    <section id="deanonymize-result-section" hidden>
      <h2>De-anonymized Text</h2>
      <div class="output-wrapper">
        <pre id="deanonymized-output" class="output-box"></pre>
        <button id="copy-deanonymized" class="btn btn-secondary">Copy to Clipboard</button>
      </div>
    </section>

    <footer>
      <p>
        Model: <a href="https://huggingface.co/bardsai/eu-pii-anonimization-multilang" target="_blank" rel="noopener">bardsai/eu-pii-anonimization-multilang</a>
        &middot; Apache 2.0
        &middot; Powered by <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noopener">Transformers.js</a>
      </p>
    </footer>
  </div>

  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify structure loads in browser**

```bash
npx vite --port 3000 &
# Open http://localhost:3000 — verify all visible sections render (model button, textarea, etc.)
# Result and de-anonymize sections should be hidden
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add complete HTML structure"
```

---

## Task 6: Main App Logic

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Write main.js — worker setup + model loading**

```javascript
// src/main.js
import { anonymizeText, deanonymizeText } from './anonymizer.js';
import './style.css';

const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
});

let currentLegend = null;

// --- DOM refs ---
const downloadBtn = document.getElementById('download-btn');
const modelStatus = document.getElementById('model-status');
const inputText = document.getElementById('input-text');
const anonymizeBtn = document.getElementById('anonymize-btn');
const resultSection = document.getElementById('result-section');
const anonymizedOutput = document.getElementById('anonymized-output');
const copyAnonymizedBtn = document.getElementById('copy-anonymized');
const legendTableBody = document.querySelector('#legend-table tbody');
const deanonymizeSection = document.getElementById('deanonymize-section');
const deanonymizeInput = document.getElementById('deanonymize-input');
const deanonymizeBtn = document.getElementById('deanonymize-btn');
const deanonymizeResultSection = document.getElementById(
  'deanonymize-result-section',
);
const deanonymizedOutput = document.getElementById('deanonymized-output');
const copyDeanonymizedBtn = document.getElementById('copy-deanonymized');

// --- Worker message handler ---
worker.onmessage = (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'progress': {
      const pct = Math.round(msg.progress ?? 0);
      modelStatus.textContent = `Downloading model... ${pct}%`;
      break;
    }
    case 'loaded':
      modelStatus.textContent = 'Model ready.';
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Model Loaded';
      anonymizeBtn.disabled = false;
      break;
    case 'error':
      modelStatus.textContent = `Error: ${msg.message}`;
      downloadBtn.disabled = false;
      anonymizeBtn.disabled = false;
      anonymizeBtn.textContent = 'Anonymize';
      break;
    case 'result':
      handleAnonymizationResult(msg.data);
      break;
  }
};

// --- Download model ---
downloadBtn.addEventListener('click', () => {
  downloadBtn.disabled = true;
  modelStatus.textContent = 'Initializing...';
  worker.postMessage({ type: 'load' });
});

// --- Anonymize ---
anonymizeBtn.addEventListener('click', () => {
  const text = inputText.value.trim();
  if (!text) return;
  anonymizeBtn.disabled = true;
  anonymizeBtn.textContent = 'Analyzing...';
  worker.postMessage({ type: 'classify', text });
});

function handleAnonymizationResult(entities) {
  const text = inputText.value.trim();
  const { anonymized, legend } = anonymizeText(text, entities);
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
  anonymizeBtn.disabled = false;
  anonymizeBtn.textContent = 'Anonymize';
}

// --- Copy anonymized ---
copyAnonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(anonymizedOutput.textContent);
  copyAnonymizedBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyAnonymizedBtn.textContent = 'Copy to Clipboard';
  }, 2000);
});

// --- De-anonymize ---
deanonymizeBtn.addEventListener('click', () => {
  const text = deanonymizeInput.value.trim();
  if (!text || !currentLegend) return;
  const result = deanonymizeText(text, currentLegend);
  deanonymizedOutput.textContent = result;
  deanonymizeResultSection.hidden = false;
});

// --- Copy de-anonymized ---
copyDeanonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(deanonymizedOutput.textContent);
  copyDeanonymizedBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyDeanonymizedBtn.textContent = 'Copy to Clipboard';
  }, 2000);
});
```

- [ ] **Step 2: Verify the page loads without JS errors**

```bash
npx vite --port 3000 &
# Open http://localhost:3000 — open DevTools console, verify no errors
# Verify: Download button visible, Anonymize button disabled
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: wire up main app logic"
```

---

## Task 7: Styling

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Write styles**

```css
/* src/style.css */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #f7f8fa;
  color: #1a1a2e;
  line-height: 1.6;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

/* --- Header --- */
header {
  text-align: center;
  margin-bottom: 2.5rem;
}

h1 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.subtitle {
  color: #555;
  font-size: 0.95rem;
}

.subtitle a {
  color: #3b82f6;
  text-decoration: none;
}

.subtitle a:hover {
  text-decoration: underline;
}

/* --- Sections --- */
section {
  margin-bottom: 2rem;
}

h2 {
  font-size: 1.3rem;
  margin-bottom: 0.75rem;
}

h3 {
  font-size: 1.1rem;
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
}

label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  font-size: 0.95rem;
}

/* --- Textarea --- */
textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9rem;
  resize: vertical;
  background: #fff;
}

textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

/* --- Buttons --- */
.btn {
  display: inline-block;
  padding: 0.6rem 1.4rem;
  border: none;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  margin-top: 0.75rem;
  transition: background 0.15s;
}

.btn-primary {
  background: #3b82f6;
  color: #fff;
}

.btn-primary:hover {
  background: #2563eb;
}

.btn-primary:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}

.btn-secondary {
  background: #e5e7eb;
  color: #374151;
}

.btn-secondary:hover {
  background: #d1d5db;
}

/* --- Output boxes --- */
.output-wrapper {
  margin-bottom: 1rem;
}

.output-box {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 1rem;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9rem;
  max-height: 400px;
  overflow-y: auto;
}

/* --- Legend table --- */
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.5rem;
}

th,
td {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  text-align: left;
  font-size: 0.9rem;
}

th {
  background: #f0f1f3;
  font-weight: 600;
}

td code {
  background: #e0e7ff;
  color: #3730a3;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-size: 0.85rem;
}

/* --- Status text --- */
#model-status {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: #555;
}

/* --- Footer --- */
footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e5e7eb;
  text-align: center;
  color: #888;
  font-size: 0.85rem;
}

footer a {
  color: #3b82f6;
  text-decoration: none;
}

footer a:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Verify styling in browser**

```bash
npx vite --port 3000 &
# Open http://localhost:3000
# Check: centered layout, styled button, textarea, header looks clean
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add src/style.css
git commit -m "feat: add styling"
```

---

## Task 8: Integration Verification

**Files:** none (manual testing)

This task verifies everything works end-to-end in the browser.

- [ ] **Step 1: Start dev server**

```bash
npx vite --port 3000
```

- [ ] **Step 2: Test model download**

Open `http://localhost:3000`. Click "Download Model". Verify:
- Button disables during download
- Status shows "Downloading model... X%"
- After completion: status shows "Model ready.", button says "Model Loaded"
- "Anonymize" button becomes enabled

- [ ] **Step 3: Test anonymization**

Paste this text into the textarea:

```
Nazywam się Jan Kowalski, mieszkam przy ul. Marszałkowskiej 10, 00-001 Warszawa.
Mój email to jan.kowalski@example.com, a numer telefonu +48 600 123 456.
Pracuję w firmie ABC Sp. z o.o., NIP: 527-020-1234.
Moja koleżanka Anna Nowak też pracuje w ABC Sp. z o.o.
```

Click "Anonymize". Verify:
- Anonymized text appears with `[PERSON_NAME_1]`, `[PERSON_NAME_2]`, `[EMAIL_ADDRESS_1]` etc.
- Same entity (e.g., "ABC Sp. z o.o." twice) uses same token
- Legend table shows all tokens with their original values
- De-anonymize section appears below

- [ ] **Step 4: Test copy to clipboard**

Click "Copy to Clipboard" on the anonymized text. Paste somewhere — verify it matches displayed text.

- [ ] **Step 5: Test de-anonymization**

Paste the anonymized text (or a modified version with tokens) into the de-anonymize textarea. Click "De-anonymize". Verify:
- Original PII values are restored
- De-anonymized result section appears
- Copy button works

- [ ] **Step 6: Run unit tests one final time**

```bash
npx vitest run
```

Expected: all 12 tests PASS.

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: complete PII anonymizer one-pager"
```

---

## Task 9: Aggregation Fallback (if needed)

> **Conditional task.** Only execute if Task 8 Step 3 reveals the NER pipeline returns raw B-/I- tagged tokens instead of aggregated entities.

**Files:**
- Modify: `src/anonymizer.js`
- Modify: `src/anonymizer.test.js`

If calling `ner(text, { aggregation_strategy: 'simple' })` in the worker throws or returns results with `entity` (e.g., `"B-PERSON_NAME"`) instead of `entity_group`, we need to aggregate sub-tokens manually.

- [ ] **Step 1: Add aggregation test**

Add to `src/anonymizer.test.js`:

```javascript
import { aggregateEntities } from './anonymizer.js';

describe('aggregateEntities', () => {
  it('merges B- and I- tokens into single entity', () => {
    const raw = [
      { entity: 'B-PERSON_NAME', score: 0.98, start: 0, end: 3, word: 'Jan' },
      { entity: 'I-PERSON_NAME', score: 0.97, start: 4, end: 13, word: 'Kowalski' },
    ];
    const result = aggregateEntities(raw);
    expect(result).toEqual([
      { entity_group: 'PERSON_NAME', score: 0.975, start: 0, end: 13 },
    ]);
  });

  it('splits on new B- tag', () => {
    const raw = [
      { entity: 'B-PERSON_NAME', score: 0.98, start: 0, end: 3, word: 'Jan' },
      { entity: 'B-EMAIL_ADDRESS', score: 0.99, start: 10, end: 22, word: 'jan@test.com' },
    ];
    const result = aggregateEntities(raw);
    expect(result.length).toBe(2);
    expect(result[0].entity_group).toBe('PERSON_NAME');
    expect(result[1].entity_group).toBe('EMAIL_ADDRESS');
  });
});
```

- [ ] **Step 2: Implement aggregateEntities**

Add to `src/anonymizer.js`:

```javascript
export function aggregateEntities(rawTokens) {
  const groups = [];
  let current = null;

  for (const token of rawTokens) {
    const isBegin = token.entity.startsWith('B-');
    const type = token.entity.replace(/^[BI]-/, '');

    if (isBegin || !current || current.type !== type) {
      if (current) groups.push(current);
      current = {
        type,
        start: token.start,
        end: token.end,
        scores: [token.score],
      };
    } else {
      current.end = token.end;
      current.scores.push(token.score);
    }
  }
  if (current) groups.push(current);

  return groups.map((g) => ({
    entity_group: g.type,
    start: g.start,
    end: g.end,
    score: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
  }));
}
```

- [ ] **Step 3: Use it in the worker classify handler**

Modify the `classify` handler in `src/worker.js` — call without `aggregation_strategy`, then pass results through `aggregateEntities`:

```javascript
if (type === 'classify') {
  try {
    const raw = await ner(e.data.text);
    // If results have entity_group, aggregation worked. Otherwise, aggregate manually.
    const data = raw[0]?.entity_group
      ? raw
      : aggregateEntities(raw);
    self.postMessage({ type: 'result', data });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
}
```

Add import at top of worker.js:

```javascript
import { aggregateEntities } from './anonymizer.js';
```

- [ ] **Step 4: Run tests, verify, commit**

```bash
npx vitest run
git add src/anonymizer.js src/anonymizer.test.js src/worker.js
git commit -m "feat: add manual entity aggregation fallback"
```
