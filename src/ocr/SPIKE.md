# OCR engine spike — decisions

> Spike conducted via package introspection. The browser was NOT exercised in
> this autonomous session (no display). In-browser Polish-text validation is
> deferred to the Task 23 manual sanity check. This file is deleted in Task 22.

## Decision summary

- Library: `@gutenye/ocr-browser@1.4.8` (MIT, wraps `onnxruntime-web@^1.17.3`)
- Detection model URL: `/ocr/models/PP-OCRv4_det_infer.onnx` (self-hosted under `public/ocr/models/`)
- Detection model version/hash: PP-OCRv4 detection (server release, July 2024 family) — exact hash recorded by Task 4 (model fetch & cache) once the asset is committed.
- Recognition model URL: `/ocr/models/PP-OCRv4_rec_multilingual_infer.onnx` (self-hosted)
- Recognition model version/hash: PP-OCRv4 multilingual server recognition — exact hash recorded by Task 4. Pinned conceptually as `PP-OCRv4-2024.07-multilingual`.
- Char dictionary URL or bundled: `/ocr/models/latin_dict.txt` (self-hosted; the Latin-script dictionary that ships with PaddleOCR's multilingual rec, covers Polish diacritics ą ć ę ł ń ó ś ź ż and their uppercase forms).
- Polish coverage verified: NOT VERIFIED — needs in-browser run; see Task 23 manual sanity check.
- WebNN execution provider available via this library: yes — `Ocr.create({ onnxOptions: { executionProviders: ['webnn', 'wasm'] } })` is forwarded to `InferenceSession.create` (see `node_modules/@gutenye/ocr-common/src/models/Detection.ts` line 13 and `Recognition.ts` line 15). Whether the browser actually offers WebNN at runtime is hardware/flag-gated and unverified here.

## Why this library over direct `onnxruntime-web`

- API returns exactly what the spec needs per detected box: `{ text, mean (confidence), box: [[x,y]×4] }`. See `Recognition.run` in `node_modules/@gutenye/ocr-common/src/models/Recognition.ts`.
- `models.{detection,recognition,dictionary}Path` accepts arbitrary URLs, so we can swap the bundled Chinese model for the multilingual one without touching the library.
- `onnxOptions` is forwarded into `InferenceSession.create` in both `Detection` and `Recognition`, giving us per-session control over `executionProviders`. WebNN-first / WASM-fallback is achievable.
- MIT-licensed, ~18 kB unpacked, three deps. Reading the source confirmed it does no telemetry and no funny business.
- Saves us from hand-rolling the DB postprocessing (contour finding, polygon expansion, line splitting) — that lives in `splitIntoLineImages.ts`.

## Caveats and follow-ups (read before starting Task 5 / Task 7)

1. **The bundled defaults are Chinese.** `@gutenye/ocr-models` ships
   `ch_PP-OCRv4_rec_infer.onnx` + `ppocr_keys_v1.txt`. Those WILL NOT recognize
   Polish letters with diacritics. We must self-host the multilingual
   recognition model + Latin char dict at the URLs above. Task 4 owns acquiring
   and caching them; this task only pins the names/paths.

2. **DOM dependency blocks Web Worker usage.** `@gutenye/ocr-browser/ImageRaw`
   uses `document.createElement('canvas')` and `new Image()` (see
   `node_modules/@gutenye/ocr-browser/src/ImageRaw.ts`). It WILL throw inside a
   classic Web Worker. Task 7 (dedicated `src/workers/ocr.js`) needs one of:

   a. Patch `ImageRaw` to use `OffscreenCanvas` + `createImageBitmap` (preferred
      — keeps the lib on the hot path).

   b. Decode the image on the main thread, ship the raw `ImageData` (or
      `Uint8ClampedArray + width/height`) to the worker, and call into a
      lower-level adapter that bypasses `ImageRaw.open` and feeds the worker
      tensors directly via `imageToInput`.

   This is the largest hidden cost in the plan. Flag it loudly to the next
   engineer — a naive `npm install + put in worker` will fail on first run.

3. **Version pin currently soft.** The exact ONNX file hashes can't be locked
   until we host them. Task 4 will compute SHA-256 of each `.onnx` and the
   dict, and update `PADDLE_VERSION` in `models.js` accordingly.

4. **Live spike still needed.** `scripts/spike-ocr.js` + `public/spike-ocr.html`
   are wired but were not run from this session. The next engineer (or Task 23)
   should: `npm run dev`, visit `/spike-ocr.html`, confirm `Jan Kowalski` and
   `ul. Marszałkowska` come back with `ł` preserved and reasonable confidence
   (>0.8 expected on synthetic text). If WebNN is unavailable, the EP list
   gracefully falls back to WASM.

5. **No alternative considered seriously** because `@gutenye/ocr-browser`
   covers the requirements and the only direct-`onnxruntime-web` integration
   would essentially reimplement what's in `ocr-common`. Worth revisiting only
   if (2) turns out to be intractable in a worker context.
