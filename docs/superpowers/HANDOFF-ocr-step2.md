# OCR step 2 — Polish recognition via custom Latin model

## Where the work happens

**Worktree:** `/Users/wjarka/code/playground/pii/.claude/worktrees/sad-ishizaka-b5b165`
**Branch:** `claude/sad-ishizaka-b5b165`

Run `pwd && git rev-parse --show-toplevel && git rev-parse --abbrev-ref HEAD` and verify all three match before touching files. Do NOT operate from `/Users/wjarka/code/playground/pii/` (that's the main repo on `main`).

## Where step 1 ended (HEAD: `8bc5206`)

Step 1 swapped from the broken community wrapper (`@gutenye/ocr-browser`, DOM-in-worker dead end) to the official upstream SDK (`@paddleocr/paddleocr-js@0.3.2`). Worker mode works in dev, end-to-end OCR runs in Chrome, plain-Latin recognition works (e.g. `Jan Kowalski / Marszalkowska / PESEL:80010112345`). 441/441 unit tests pass. Production build clean.

What still doesn't work: Polish diacritics (`ą ć ę ł ń ó ś ź ż`). The default rec model is PaddleOCR's `PP-OCRv5_mobile_rec` (Chinese + English). For Polish we need to override `textRecognitionModelAsset` with the `latin_PP-OCRv5_mobile_rec` model — but Paddle only publishes it in `.pdparams` format, not ONNX. Step 2 = self-host an ONNX-converted version.

## Step 2 plan

### 2a. Convert latin_PP-OCRv5_mobile_rec to ONNX

Source model on Hugging Face: `https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec/tree/main` — has `inference.json`, `inference.pdiparams`, `inference.yml`, `config.json`. No ONNX.

Use `paddle2onnx` in an isolated Python venv:

```bash
mkdir -p /tmp/paddle-conv && cd /tmp/paddle-conv
python3 -m venv venv && source venv/bin/activate
pip install paddle2onnx paddlepaddle huggingface_hub
huggingface-cli download PaddlePaddle/latin_PP-OCRv5_mobile_rec --local-dir ./latin_rec
paddle2onnx \
  --model_dir ./latin_rec \
  --model_filename inference.json \
  --params_filename inference.pdiparams \
  --save_file ./inference.onnx \
  --opset_version 14
```

Note: PP-OCRv5 uses the new `inference.json` config format (Paddle 3.x), not the older `.pdmodel`. paddle2onnx ≥ 2.0 handles it. If paddle2onnx fails on the json format, try `--model_filename inference.pdmodel` if HF includes it, or check `pip install -U paddle2onnx` for a newer release.

### 2b. Package as ustar tar matching the SDK's expected layout

The SDK's [resources/model-asset.ts](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/src/resources/model-asset.ts) requires:
- uncompressed ustar `.tar` (NOT `.tar.gz`)
- entries: `inference.onnx` and `inference.yml` (basenames matched, can be in subdir)
- `inference.yml` must define `model_name` matching the user-passed `textRecognitionModelName`

```bash
# In /tmp/paddle-conv after step 2a
tar --format=ustar -cf latin_PP-OCRv5_mobile_rec.tar inference.onnx ./latin_rec/inference.yml
# Verify: tar -tvf latin_PP-OCRv5_mobile_rec.tar should list both files
```

If `inference.yml`'s `model_name` field is missing or wrong, edit it manually before tarring:

```bash
# Make sure top-level has: model_name: latin_PP-OCRv5_mobile_rec
yq -i '.model_name = "latin_PP-OCRv5_mobile_rec"' ./latin_rec/inference.yml
```

### 2c. Host in public/

Move the resulting tar into the worktree:

```bash
cp /tmp/paddle-conv/latin_PP-OCRv5_mobile_rec.tar \
  /Users/wjarka/code/playground/pii/.claude/worktrees/sad-ishizaka-b5b165/public/ocr-models/
```

Vite dev server will serve it at `http://localhost:5173/pii-anonymizer/ocr-models/latin_PP-OCRv5_mobile_rec.tar`.

(`public/ocr-models/` already has the convention via `noSpaFallbackForLocalModels` plugin in `vite.config.js` for `/local-models/`. Either reuse that path or add `ocr-models` to the no-fallback list — see vite.config.js, lines 12-28.)

### 2d. Wire it up in src/ocr/paddle.js

Pass the override via `sdkOptions` (already a dependency injection point on `createPaddleEngine`). The cleanest place: hardcode it in `defaultLoadSdk`'s call site, or thread through from `createOcr` → `createPaddleEngine`. Suggested:

```js
// src/ocr/paddle.js — adapt the existing PaddleOCR.create() call
const made = await PaddleOCR.create({
  worker: createWorker ? { createWorker } : true,
  ortOptions,
  textRecognitionModelName: 'latin_PP-OCRv5_mobile_rec',
  textRecognitionModelAsset: {
    url: new URL('/pii-anonymizer/ocr-models/latin_PP-OCRv5_mobile_rec.tar', window.location.origin).href,
  },
  ...sdkOptions,
});
```

The `new URL(..., window.location.origin)` avoids hardcoding the dev host. For production at a different base, derive from `import.meta.env.BASE_URL`.

### 2e. Verify in Chrome

Same flow as step 1's verification:

1. `npm run dev`
2. Browse to `http://localhost:5173/pii-anonymizer/`
3. Drop a file with Polish diacritics. Use a fresh fixture or generate one ad-hoc:

```js
// In Chrome DevTools console:
const c = document.createElement('canvas'); c.width = 1200; c.height = 400;
const ctx = c.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height);
ctx.fillStyle = 'black'; ctx.font = '32px sans-serif';
ctx.fillText('Jan Kowalski', 40, 60);
ctx.fillText('ul. Marszałkowska 1, 00-001 Warszawa', 40, 110);
ctx.fillText('Kraków, Łódź, Wrocław, Gdańsk', 40, 160);
ctx.fillText('PESEL: 80010112345', 40, 210);
c.toBlob(async (blob) => {
  const file = new File([blob], 'polish-test.png', { type: 'image/png' });
  const root = document.getElementById('workspace-root');
  const dt = new DataTransfer(); dt.items.add(file);
  root.querySelector('[data-testid="workspace-dropzone"]')
    .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
});
```

Expected: textarea contains `Marszałkowska` (with `ł`), `Kraków` (with `ó`), `Łódź` (with `ł`, `ó`, `ź`), `Gdańsk` (with `ń`).

### 2f. e2e fixture update

Once the Polish model works, update `scripts/build-e2e-fixtures.js` to use real diacritics in `sample-photo.png` and `sample-scanned.pdf` text — Task 16 deliberately used ASCII-only `Marszalkowska` because the spike model couldn't handle it. Now we can.

The e2e specs already check for `'Jan'` substring; they'll keep passing. Add an extra assertion in `e2e/ocr-image.spec.js` that the diacritic survived, e.g. `expect(value).toMatch(/Marszałkowska|Łódź/)`.

### 2g. Commit + done

Suggested commit boundary:
1. Asset: `feat(ocr): bundle ONNX-converted Latin recognition model for Polish coverage`
   - Includes `public/ocr-models/latin_PP-OCRv5_mobile_rec.tar`
   - Updates `vite.config.js` no-fallback if needed
2. Wiring: `feat(ocr): point PaddleOCR at Latin rec model so Polish diacritics work`
   - Updates `src/ocr/paddle.js`
   - Updates `src/ocr/models.js` if you add an asset URL constant there
3. Fixtures: `test(e2e): regenerate fixtures with real Polish diacritics now that OCR supports them`
   - Updates `scripts/build-e2e-fixtures.js`
   - Regenerated binaries in `e2e/fixtures/`
   - Updated assertion in `e2e/ocr-image.spec.js`

## Known landmines / shortcuts

- **paddle2onnx may need `--enable_dev_version True` flag** on older releases to handle Paddle 3.x format. The flag is harmless on newer releases.
- **Tar format matters.** Use `tar --format=ustar`. macOS BSD `tar` defaults to ustar already, GNU `tar` defaults to pax. The SDK explicitly rejects `.tar.gz` — do NOT pipe through gzip.
- **Worker still works after the model swap?** Yes — the SDK's worker hosts the ONNX runtime; the model URL is just a config. Same wiring as step 1.
- **`public/ocr-models/` doesn't exist yet** — `mkdir -p` it as part of step 2c.
- **WebNN deferred.** `ortOptions.backend` stays `'wasm'` for now per user direction. WebNN can come once WASM Polish OCR is verified.

## Don't do these

- Do not pivot to Tesseract.js or any other library. The PaddleOCR direction is the user-approved spec; step 2 is just sourcing a Polish-capable rec model for it.
- Do not run subagents for this — directory confusion bit twice this session. If you must dispatch, paste the worktree path verbatim three times in the prompt and have the subagent print `pwd && git rev-parse --show-toplevel && git rev-parse --abbrev-ref HEAD` BEFORE writing any file.
- Do not commit the converted ONNX without verifying with `tar -tvf` that the archive contains exactly the expected files in ustar format.
- Do not push to remote unless the user asks. The branch is local-only.

## Side-quest: clean up main branch (optional)

Earlier in the session, three subagents accidentally committed to the main repo (`/Users/wjarka/code/playground/pii/`) instead of the worktree. The bogus commits on `main` are `2d8586c`, `ff7f52d`, `a45caef` — none pushed. To restore:

```bash
git -C /Users/wjarka/code/playground/pii reset --hard b052026
```

Confirm with the user before running. `b052026` was the pre-incident tip.
