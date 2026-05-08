# Browser-local OCR for scanned PDFs and images — design

**Status:** approved (brainstorming)
**Date:** 2026-05-08

## Goal

Extend the existing file-import pipeline so the user can hand the anonymizer:

1. an **image** (PNG, JPEG, HEIC/HEIF) of a document, and
2. a **scanned or mixed PDF** where some or all pages have no extractable text,

and get text back — entirely client-side. The recovered text fills the existing textarea where the user reviews and corrects before clicking Anonimizuj. The NER pipeline downstream is unchanged. The privacy contract is preserved.

The first user is a Polish lawyer who often receives bad-quality phone photos of paper documents. Quality must hold up well enough that Polish names with diacritics (ą/ć/ę/ł/ń/ó/ś/ź/ż), addresses, NIP, and PESEL survive OCR cleanly enough for downstream NER to find them.

## Non-goals (v1)

- VLM-tier OCR (Qwen2-VL, GOT-OCR-2.0, Florence-2) for severely degraded photos. The architecture leaves room for a follow-up "Popraw jakość" hybrid that lazily downloads a heavyweight model.
- Multi-page TIFF, WebP. Same dispatch table can host them later.
- Multi-image batch upload.
- Confidence-aware overlay UI / side-by-side image+text correction view.
- Surfacing per-character or per-word confidence in the textarea.
- End-to-end (OCR → NER) accuracy eval. The current eval bucket measures NER on clean text and stays that way; OCR quality is a separate concern and would be its own follow-up spec if pursued.

## Engine choice

**PaddleOCR PP-OCRv4 (multilingual Latin)** running on **`onnxruntime-web`** with the **WebNN execution provider** (WASM CPU fallback).

Why:

- The existing NER worker already uses WebNN for token-classification acceleration, so the runtime path is proven on this app.
- PaddleOCR is a two-stage CNN pipeline (text detection → text recognition). Both stages are pure convolutional with single-pass forward inference and static-ish shapes. That's exactly what WebNN execution providers (DirectML / CoreML / NNAPI) handle well — no autoregressive decoder, no growing KV cache.
- The detection stage finds text regions in a photo regardless of skew, perspective, or lighting variance, which is the realistic phone-photo failure mode. We do not need a separate deskew/binarize preprocessing pass.
- Total model footprint: detection ~3 MB, recognition ~10 MB, char dictionary ~50 KB. Lazy-loaded on first OCR. Comparable to the existing pdf.js / mammoth additions and far below VLM-class downloads.
- Polish characters are covered by the multilingual Latin recognition model (PP-OCRv4 multilingual variant). Final ONNX URL/version pinning is deferred to plan stage pending availability and Polish-coverage check.

Rejected alternatives:

- **Tesseract.js + canvas preprocessing** — well-trodden, ~10 MB Polish traineddata, but quality on bad phone photos with Polish diacritics is too weak. NIP/PESEL digit confusion and dropped diacritics break downstream NER.
- **Encoder-decoder transformer OCR (GOT-OCR-2.0, Florence-2, TrOCR)** — high quality, but the autoregressive decoder is poorly served by WebNN today (dynamic shapes, growing KV cache); transformers.js falls back to WASM CPU for the decode step, which dominates wall time on long pages. WebGPU would be the realistic acceleration path, contradicting the WebNN-already-wired premise.
- **VLMs (Qwen2-VL, SmolVLM, Phi-3.5-vision)** — best ceiling on extreme degradation, but 1–2 GB download, WebGPU effectively required, overkill for OCR-only use.

If real-world quality on the lawyer's worst photos turns out insufficient, the follow-up is a "Popraw jakość" path that lazily downloads a heavyweight transformer/VLM and re-runs against the same input — an additive change, not a replacement.

## UX

### Image drop (PNG / JPEG / HEIC / HEIF)

The existing dropzone shows the spinner with message "Przetwarzanie obrazu…". OCR runs. On success, transition to `'loaded'` with text in the textarea and the file pill rendered as `📄 photo.jpg · OCR`. The `· OCR` segment is the visible signal that text came from OCR (not direct extraction) so the user knows to scrutinize.

The same drop/click semantics from the existing file-upload spec apply — the dropzone is the interaction target, the textarea takes drops too in `text` mode, drops are ignored in `annotation` mode.

### PDF drop

A fast text-content scan runs first (no rendering), per page:

- For each page, read `getTextContent()` and count non-whitespace characters.
- If a page has more than `PAGE_TEXT_THRESHOLD` non-whitespace chars (default 20), it is **text-path** — the extracted items are kept as today.
- Otherwise it is **OCR-path**.

Three resulting cases:

1. **All pages text-path** → existing behavior, no UI change. The current binary `ScannedPdfError` heuristic is removed in favor of this per-page check.
2. **Some pages OCR-path (mixed PDF)** → auto-start OCR for those pages, in page order. Text-path pages keep their extracted text, OCR-path pages get OCR'd output. The two streams are concatenated in original page order.
3. **All pages OCR-path** → same as (2) but every page goes through OCR.

In cases (2) and (3), the dropzone progress message updates per page: `Przetwarzanie strony X z Y (OCR)…`. A Cancel button is shown beside the spinner during OCR. Cancel returns to the empty dropzone with no message (silent abort).

On success, the file pill carries an OCR breadcrumb listing OCR'd page ranges: `📄 contract.pdf · OCR: strony 3–7` (or `· OCR: strony 1, 3, 5–7` with comma-separated ranges if non-contiguous). When all pages were OCR'd, render simply `· OCR: wszystkie strony`. The pill persists for the lifetime of `'loaded'`.

### Errors

Added to the existing inline error region (`aria-live="assertive"`):

| Error class | Message (PL) | Recovery |
|---|---|---|
| `WebNNUnavailableError` (and WASM also fails) | "Twoja przeglądarka nie obsługuje OCR. Wklej tekst ręcznie." | "Wklej tekst" → `'loaded'` empty |
| `OcrFailedError` (whole-document failure) | "Nie udało się przeprowadzić OCR. Spróbuj ponownie lub wklej tekst." | dropzone stays + "Wklej tekst" |
| `OcrCancelledError` | (silent — return to dropzone) | — |
| Per-page OCR failure | concatenated text includes `[OCR strony N nie powiódł się]` for that page; document continues | user fixes inline in textarea |

WebNN unavailable but WASM works → silent WASM fallback (slower); the chosen backend is recorded in `meta.ocr.backend` for diagnostics. No user-facing error in this case.

### Accessibility

- Cancel button is reachable by Tab, has `aria-label="Anuluj OCR"`.
- Progress text updates via `aria-live="polite"`.
- Existing dropzone affordances unchanged.

## Architecture

### `src/ocr/` — engine module

```
src/ocr/
  index.js        — public surface
                    ocrImage(blob): Promise<{ text, meta }>
                    ocrBitmap(imageBitmap): Promise<{ text, confidence }>
                    init(): Promise<void>
                    cancel(): void
  paddle.js       — engine wrapper: ort session, WebNN EP config,
                    detection → recognition pipeline,
                    backend selection (webnn → wasm fallback)
  models.js       — model URLs, IndexedDB / Cache API keys, version tags
  postprocess.js  — assemble recognized boxes into paragraph order
                    (top-to-bottom, left-to-right, line grouping by y-coord)
  errors.js       — WebNNUnavailableError, OcrFailedError, OcrCancelledError
```

`ocrImage` decodes an image blob via `createImageBitmap` and forwards. `ocrBitmap` takes a ready ImageBitmap (used by the PDF path: `OffscreenCanvas` → `transferToImageBitmap()` → ImageBitmap is transferable to the worker). Both call the same det+rec pipeline.

`init()` is idempotent and lazy — first call downloads models, creates ort sessions, configures the EP. Subsequent calls return immediately. Callers do not need to invoke `init()` directly; `ocrImage` / `ocrBitmap` await it internally.

`cancel()` flips a shared abort flag in the worker. The flag is checked between pages, between detection and recognition, and between recognition crops. Throws `OcrCancelledError` from the in-flight call.

### `src/workers/ocr.js` — dedicated OCR worker

A new Web Worker, separate from the existing NER worker, owning the ort sessions. Decoupling reasons:

- Different model lifecycle (NER models are heavier, loaded eagerly on app start; OCR models are lazy).
- Different acceleration paths (NER is encoder-only; OCR is two-stage CNN); keeping the runtimes separate avoids accidental coupling.
- Cancel semantics affect only OCR work.

Message protocol:

```
// main → worker
{ type: 'init' }
{ type: 'ocr:run', id, imageBitmap }        // ImageBitmap (Transferable)
{ type: 'cancel', id? }                     // id omitted = cancel all in-flight

// worker → main
{ type: 'model:load:start', engine: 'paddleocr-v4' }
{ type: 'model:load:end',   engine: 'paddleocr-v4' }
{ type: 'ocr:progress', id, stage: 'detection' | 'recognition', current?, total? }
{ type: 'ocr:done', id, text, confidence, backend }
{ type: 'ocr:error', id, name, message }   // structured error
```

The `model:load:start` / `model:load:end` shape matches the existing NER worker convention so the bench/timing wiring keeps working consistently.

### `src/file-import/` — extended

```
src/file-import/
  image.js        — NEW. Dispatches PNG/JPEG/HEIC/HEIF.
                    HEIC/HEIF: lazy-imports heic-to, converts to JPEG blob.
                    PNG/JPEG: createImageBitmap directly.
                    Calls ocr.ocrImage, returns { text, meta }.
  image.test.js   — NEW.
  pdf.js          — EXTENDED. Per-page logic replaces the binary
                    ScannedPdfError heuristic:
                      1. const content = page.getTextContent()
                      2. const nonWs = countNonWhitespace(content)
                      3. if nonWs > PAGE_TEXT_THRESHOLD:
                           → text-path: keep extracted items
                      4. else:
                           → render page to OffscreenCanvas at scale=2.0
                           → transferToImageBitmap → ocr.ocrBitmap(bitmap)
                           → release canvas/bitmap
                      5. record per-page { index, source, confidence? } in meta
                    Cancel propagates from caller (file-import wraps a single
                    AbortSignal and forwards it to ocr.cancel()).
  pdf.test.js     — EXTENDED with mixed-PDF and full-OCR-PDF cases.
  index.js        — EXTENDED. MIME / extension dispatch:
                      'image/png', 'image/jpeg' (extensions: png, jpg, jpeg)
                      'image/heic', 'image/heif' (extensions: heic, heif)
                    Accept attribute extended accordingly.
  errors.js       — EXTENDED. Re-export WebNNUnavailableError, OcrFailedError,
                    OcrCancelledError from src/ocr/errors.js so all file-import
                    consumers get one error namespace.
```

The existing `MAX_BYTES = 25 * 1024 * 1024` cap applies uniformly. Rationale: a 25 MB iPhone HEIC or 25 MB scanned PDF is at the realistic upper end of what we want to OCR in-browser; larger inputs warn the user with `FileTooLargeError`.

`ScannedPdfError` is removed from `src/file-import/errors.js`. The `e2e/scanned-pdf` flow that currently exercises it is replaced with the OCR happy path.

### `src/ui/workspace/` — UI updates

Two surface-level changes:

- **File pill rendering** — when `meta.pages` contains entries with `source: 'ocr'`, append `· OCR: <range expression>` (or `· OCR` for image inputs). For non-OCR uploads the pill is unchanged.
- **Progress message** — when the active operation reports `ocr:progress`, render `Przetwarzanie strony X z Y (OCR)...`. For image uploads, render the static "Przetwarzanie obrazu…". A Cancel button is rendered alongside the spinner only while an OCR operation is in flight.

The workspace state machine (`'empty'` ↔ `'loaded'`) is unchanged.

## Data shape

```js
ExtractionMeta = {
  filename: string,
  mimeType: string,
  sizeBytes: number,
  pageCount?: number,           // PDF only
  pages?: Array<{               // PDF only
    index: number,              // 1-based, matches user-facing page numbers
    source: 'text' | 'ocr',
    confidence?: number,        // OCR only; mean over recognized boxes
  }>,
  ocr?: {                       // present iff at least one OCR run happened
    engine: 'paddleocr-v4',
    modelVersion: string,
    backend: 'webnn' | 'wasm',
  },
}
```

## Implementation details

### Render scale (PDF → canvas)

`scale = 2.0` (≈ 200 DPI for typical A4 PDFs). Static for v1. This is the standard sweet spot for OCR — higher scales improve recognition on small text but cost render time and peak memory linearly.

### Per-page text threshold

`PAGE_TEXT_THRESHOLD = 20` non-whitespace characters per page. This replaces the existing `SCAN_DETECT_AVG_CHARS_PER_PAGE = 50` (which was a doc-level average). The threshold lives as a constant in `src/file-import/pdf.js`. Edge cases:

- Page with only a page number ("3") → 1 char → OCR-path. Wasted OCR, but harmless. Acceptable.
- Page with a few footnote characters → likely text-path. Fine — text path output is better than OCR for that case anyway.

### Memory

Canvas lifecycle is strictly per-page: render to OffscreenCanvas → `transferToImageBitmap()` → transfer ImageBitmap to worker (the main-thread reference is neutered on transfer) → worker runs OCR → discard. No more than one page's canvas exists at a time on the main thread. The worker holds at most the current page's input plus the model weights.

### HEIC handling

`heic-to` (Apache 2.0, ~200 KB, modern async API, no `XMLHttpRequest` legacy) is lazy-imported in `src/file-import/image.js` only when a HEIC/HEIF input is detected. Output is a JPEG blob that flows into the same `createImageBitmap` path as native JPEG.

### WebNN / WASM backend selection

`src/ocr/paddle.js` attempts to create the ort session with `executionProviders: ['webnn']` first; on session-creation failure or model-incompatibility error, retries with `['wasm']`. The chosen backend is recorded on the engine instance and reported to the worker → main as `meta.ocr.backend`. WASM CPU is materially slower (think 3–5×) but functional; for v1 we accept that tradeoff rather than gating OCR behind WebNN availability.

If both fail (`OcrFailedError` from session creation), the main thread surfaces `WebNNUnavailableError` to the workspace error region. (The error class name is kept user-facing for clarity; the actual code distinguishes initialization failure from runtime failure.)

### Cancellation

A shared `Uint8Array(1)` `SharedArrayBuffer` flag would be cleanest but requires cross-origin-isolated headers. For v1, a worker-local `cancelRequested` boolean is set on `cancel` messages; the OCR loop checks it between pages and between det/rec phases. Granularity is per-page (a page already mid-detection finishes detection, then aborts before recognition). This is acceptable — pages are at most a few seconds each on WebNN.

### Caching

ONNX model files are fetched from a stable URL (CDN-pinned; exact host deferred to plan stage), cached via the Cache API under a versioned key (`ocr-paddleocr-v4-<modelVersion>`). On-load: try cache, fall back to network, populate cache. This matches how the existing NER worker handles its model assets.

### First-time download UX

The OCR worker emits `model:load:start` when initialization begins and `model:load:end` when ort sessions are ready. The workspace listens and, if the load takes more than a small threshold (e.g. 500 ms), shows "Pobieranie modelu OCR (jednorazowo)…" in the progress region. After cache population, subsequent runs skip the download and the message never appears.

## Tests

Eval, bench, and e2e remain three separate buckets per the existing convention. OCR work touches e2e and unit; eval and bench are not extended.

### Unit (vitest)

- `src/ocr/paddle.test.js` — pre/post-processing logic with a mocked ort session: image normalization, detection-box → recognition-crop math, line grouping by y-coordinate, backend-selection fallback path.
- `src/ocr/index.test.js` — public surface: `init` idempotency, `ocrImage` → engine call, `cancel` → throws `OcrCancelledError` from in-flight, error wrapping for unexpected exceptions.
- `src/file-import/image.test.js` — dispatch, MIME / extension cases, HEIC path with `heic-to` mocked, error wrapping. Size-cap behavior is already covered in `index.test.js` and is not duplicated here.
- `src/file-import/pdf.test.js` — extend with (`ocr.ocrBitmap` mocked):
  - mixed-PDF case: page 1 text-path, page 2 OCR-path → concatenated text and `meta.pages` shape.
  - full-OCR-PDF case: all pages OCR-path → range expression formatting.
  - threshold edge: page with exactly `PAGE_TEXT_THRESHOLD` chars → text-path.
  - cancellation: cancel mid-OCR → second page's OCR not invoked.
- `src/ui/workspace/workspace.test.js` — extend with file-pill OCR rendering (range-expression cases) and OCR progress message rendering.

### e2e (Playwright, existing `e2e/` bucket)

Runs in headless Chromium where WebNN is unavailable; OCR runs on the WASM fallback path. We're validating wiring, not OCR quality.

- `e2e/ocr-image.spec.js` — drop a synthetic PNG fixture rendered with high-contrast Polish text → text appears in textarea, file pill says `· OCR`.
- `e2e/ocr-pdf-mixed.spec.js` — drop a fixture PDF with one text page and one image page → text concatenated in page order, file pill says `· OCR: strona 2`.
- `e2e/ocr-pdf-cancel.spec.js` — drop a multi-page scanned PDF, click Cancel mid-run → workspace returns to dropzone, no error message.
- The existing `e2e/upload.spec.js` scanned-PDF case (which currently asserts `ScannedPdfError`) is rewritten to assert the OCR happy path instead.

Synthetic fixtures kept under `test-data/fixtures/` keep repo size bounded. One real-world phone-photo fixture (1 image, lossy-compressed) added for realism in `e2e/ocr-image.spec.js`.

### Eval and bench

Unchanged. The current eval pipeline measures NER on clean ground-truth text; injecting OCR upstream would conflate two error sources and is the wrong shape for the existing `score.js` matching code. If end-to-end OCR-then-NER quality measurement is wanted, that's a follow-up spec with its own bucket — do not graft onto eval/.

## Dependencies added

- `onnxruntime-web` (MIT) — direct dependency. Already pulled transitively via `@huggingface/transformers`; pinning explicit makes the OCR runtime path independent of the transformers.js version.
- `heic-to` (Apache 2.0, lazy-imported, image-only path).
- PP-OCRv4 ONNX model assets (detection, recognition, character dictionary) — fetched at runtime, cached. Not bundled.

Both library deps are added to `dependencies`; `heic-to` and `onnxruntime-web` paths in `src/ocr/` and `src/file-import/image.js` are dynamic imports so the main bundle is unchanged for users who never upload an image or scanned PDF.

## Open items deferred to plan stage

- Exact PP-OCRv4 ONNX URL/version pinning. Plan-stage spike must verify Polish coverage of the multilingual Latin recognition model on a small fixture set (Polish names, addresses, NIP/PESEL) before locking the model version.
- Whether to surface aggregate confidence (e.g. `meta.ocr.meanConfidence`) anywhere in the UI, or keep it internal. v1 keeps it internal.
- Range expression formatting helper for the file pill — exact comma/dash rules for non-contiguous OCR'd pages.
- Whether `init()` should be triggered eagerly when the dropzone first mounts (to start the cache-warming download) or only on first OCR. v1 leans lazy — eager priming risks downloading models for users who never upload an image / scanned PDF.
- E2e fixture sourcing: synthetic image generation script vs. a small real-world image checked into the repo. Repo size budget.
- Whether `SharedArrayBuffer`-based cancel is worth the cross-origin-isolation cost later (probably not — per-page cancel granularity is fine).
