# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Browser-based PII anonymizer for Polish legal documents. Uses HuggingFace transformer models (bardsai/eu-pii-anonimization variants) for NER, runs entirely client-side via Web Worker. Includes an evaluation framework for measuring detection quality against annotated ground-truth documents.

## Commands

```bash
npm run dev              # Vite dev server
npm run build            # Production build → dist/
npm test                 # Run all tests once (vitest run)
npm run test:watch       # Watch mode
npx vitest run src/pipeline/steps/steps.test.js  # Single test file

# Evaluation (downloads models on first run, takes minutes)
npm run eval             # Process test-data/synthetic/*.txt through pipeline
npm run eval -- --label=my-run  # Tag a run
npm run eval:score       # Compute precision/recall/F1 against .expected.json
npm run eval:compare     # Diff two runs
npm run eval:list        # List available runs
```

## Architecture

### Pipeline

Core abstraction: a linear pipeline of phases, each containing ordered steps. Every step is an `async (ctx) => ctx` function that receives and returns a context object.

**Context shape** (`src/pipeline/context.js`):
```js
{ text, segments, entities, anonymized, legend, debug }
```

**Phases** (defined in `src/pipeline/configs/default.js`):
1. **preprocess** — normalize whitespace
2. **segment** — split text into sentences (sentencex), chunk long sentences at 900 chars
3. **ner** — run two HF models + regex patterns to extract entities
4. **postprocess** — filter allowed types → snap to word boundaries → filter low-confidence → dedup → merge adjacent → tokenize → rescan for missed PII

The runner (`src/pipeline/runner.js`) threads context through steps and records debug diffs between each step.

### Browser vs Node

- **Browser**: `src/main.js` → `src/worker.js` (Web Worker loads models, runs pipeline)
- **Node** (eval only): `src/eval/run.js` uses `@huggingface/transformers` + `onnxruntime-node` directly

Pipeline steps are environment-agnostic. Model loading is injected via `loadModel` parameter.

### Eval Framework

Ground truth lives in `test-data/synthetic/` as paired `.txt` + `.expected.json` files. Eval runs are stored in `test-data/results/{timestamp}/` with a `latest` symlink. Scoring (`src/eval/score.js`) computes per-document and aggregate precision/recall/F1 using overlap-based entity matching (`src/eval/matching.js`).

## Conventions

- Pure ESM (`"type": "module"` in package.json)
- Vitest with `globals: true` — no imports needed for `describe`/`it`/`expect`
- No TypeScript, no linter configured
- Pipeline steps are named functions (name appears in debug output)
- Entity format: `{ entity_group, start, end, score, word }`
