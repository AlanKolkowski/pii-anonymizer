# File upload (.txt / .docx / .pdf) — design

**Status:** approved (brainstorming)
**Date:** 2026-05-07

## Goal

Let users hand the anonymizer a file instead of pasting text. Drop a `.txt`, `.docx`, or text-based `.pdf` onto the input area; extracted text fills the existing textarea where the user can review and correct before clicking Anonimizuj.

Everything stays client-side. Privacy contract is preserved.

## Non-goals (v1)

- OCR. Scanned PDFs and image uploads (PNG/JPG) are out of scope. Architecture leaves room for an `ocr.js` extractor later.
- Multi-file batch upload.
- `.rtf`, `.odt`, `.html`. Same dispatch table can host them later.
- Per-page extraction progress UI.
- Pasting images as files.

## UX

The current `text` mode of the annotation editor is replaced with a wrapper that has two states.

### State: `'empty'`

A dropzone replaces the textarea. Centered:

- icon (📄)
- primary line: "Upuść plik (.docx, .pdf, .txt)"
- secondary line: "lub kliknij aby wkleić tekst"

Click anywhere in the dropzone (other than the file picker affordance) → transition to `'loaded'` with empty text and the textarea focused. Dropping a supported file → run extractor → on success transition to `'loaded'` with the extracted text.

### State: `'loaded'`

The annotation editor mounts with the current text/annotation behavior unchanged. A small toolbar above the editor shows:

- file metadata pill (`📄 contract.docx`) when the current `'loaded'` lifecycle started from a file upload. Persists for the lifetime of `'loaded'` even if the user edits the text. Hidden when `'loaded'` was entered via empty-click (paste path).
- "Wgraj inny plik" button → opens file picker.
- "Wyczyść" button → clears text + entities, returns to `'empty'`.

`'loaded'` does not auto-revert to `'empty'` if the user deletes all characters from the textarea. The textarea simply becomes empty within `'loaded'`. Only the explicit Wyczyść button transitions back. This avoids losing focus and the dropzone reappearing mid-edit on a stray Ctrl+A Delete.

Drag/drop continues to work on the textarea in `text` mode:

- if textarea is empty → extract → set text.
- if textarea is non-empty → confirm "Zastąpić obecny tekst?" → on confirm extract and replace, clearing entities.

In `annotation` mode, drop is ignored. Users must Wyczyść (or Edytuj tekst → Wyczyść) first.

### Loading

While extraction runs, the dropzone (or textarea overlay during replace) shows a spinner and "Przetwarzanie pliku...". Drop and click are disabled. `aria-live="polite"`.

### Errors (inline, inside dropzone)

| Error class | Message (PL) | Recovery |
|---|---|---|
| `UnsupportedTypeError` | "Nieobsługiwany typ pliku. Akceptujemy: .pdf, .docx, .txt" | dropzone stays |
| `FileTooLargeError` | "Plik jest za duży (X MB / limit 25 MB)" | dropzone stays |
| `ScannedPdfError` | "Wygląda na zeskanowany PDF. Wklej tekst ręcznie." | "Wklej tekst" button → `'loaded'` empty |
| `ExtractionFailedError` | "Nie udało się odczytać pliku. Spróbuj ponownie lub wklej tekst." | "Wklej tekst" button |

Errors render in an `aria-live="assertive"` region. Dropzone remains active for retry.

### Accessibility

- Dropzone is a focusable element (`role="button"`, `tabindex="0"`); Enter/Space triggers file picker.
- Hidden `<input type="file" accept=".pdf,.docx,.txt">` co-located, programmatically clicked.
- `dragenter`/`dragleave` use a counter so child enter/leave doesn't drop the highlight.

## Architecture

### Wrapper component

`src/ui/workspace/index.js` — exports `createWorkspace(rootEl, options)`. The annotation editor is unchanged; the wrapper hosts it.

```
createWorkspace(root, {
  text, entities,
  entityCategories, entityLabels,
  postEdit,
  onChange, onModeChange,
})
  ├─ state: 'empty' | 'loaded'
  ├─ when 'empty': renders dropzone
  ├─ when 'loaded': renders toolbar (file pill, Wgraj inny plik, Wyczyść) + editor
  └─ same public API the editor exposes today (getText, setText, etc.)
```

`main.js` change is one line: `createAnnotationEditor` → `createWorkspace`. `onChange` and `onModeChange` callbacks pass through to the editor.

The existing `.workspace-actions` row (Anonimizuj / Edytuj / Kopiuj) stays in `index.html` as it is.

### Extraction module

`src/file-import/`

```
src/file-import/
  index.js         — extractText(file) dispatches by mime/extension
  txt.js           — eager (FileReader, no dep)
  pdf.js           — lazy: import('pdfjs-dist')
  docx.js          — lazy: import('mammoth')
  errors.js        — UnsupportedTypeError, FileTooLargeError,
                     ScannedPdfError, ExtractionFailedError
```

Public surface:

```js
extractText(file): Promise<{ text: string, meta: ExtractionMeta }>

ExtractionMeta = {
  filename: string,
  mimeType: string,
  sizeBytes: number,
  pageCount?: number,   // PDFs only
}
```

- `MAX_BYTES = 25 * 1024 * 1024` — configurable constant in `index.js`.
- `inferType` checks extension first, then `file.type` (browsers report `.docx` mime inconsistently).
- pdf extractor: loops `pdf.getPage(i).getTextContent()` and joins items with whitespace from item geometry. Heuristic for scan detection: if `pageCount > 0` and `nonWhitespaceChars / pageCount < 50`, throws `ScannedPdfError`. The threshold is generous (fully blank pages drag the average down legitimately) and conservative (scanned books rarely produce any extractable text). Constant lives in `pdf.js` as `SCAN_DETECT_AVG_CHARS_PER_PAGE = 50`.
- docx extractor: `mammoth.extractRawText({ arrayBuffer })`. Styles, comments, images dropped.
- txt extractor: `await file.text()`.

Lazy imports keep ~350 KB gzipped of dependencies out of the main bundle. First upload of each format pays the one-time fetch.

### Dependencies

- `pdfjs-dist` (Mozilla pdf.js) — Apache 2.0, browser-friendly, well maintained.
- `mammoth` — MIT, browser build supports `extractRawText` from an ArrayBuffer.

Both are added to `dependencies`, dynamically imported.

## Tests

Tests are placed by purpose. **Eval, bench, and e2e are three separate buckets.** Eval = accuracy, bench = performance, e2e = app behavior. Do not graft new buckets onto existing ones.

### Unit (vitest, `src/**/*.test.js`)

- `src/file-import/index.test.js` — dispatch, size cap, type inference, error classes.
- `src/file-import/txt.test.js` — UTF-8, BOM, line-ending behavior.
- `src/file-import/pdf.test.js` — pdf.js mocked: multi-page concat, ScannedPdfError, error wrapping.
- `src/file-import/docx.test.js` — mammoth mocked: pass-through, error wrapping.
- `src/ui/workspace/workspace.test.js` — DOM tests:
  - initial `'empty'` renders dropzone
  - click dropzone → editor mounted, textarea focused, no file pill
  - drop succeeds → editor mounted, text populated, file pill shown
  - Wyczyść → returns to dropzone, entities cleared
  - drop in `'loaded'` non-empty → confirm; replace on confirm; no-op on cancel
  - drop in annotation mode → ignored
  - each error class renders the right inline message + recovery affordance

### e2e (new bucket: `e2e/`)

A new sibling top-level directory with its own Playwright config. Drives the dev server like bench, but asserts UI behavior, not timings.

- `e2e/upload.spec.js` — load app, drop a fixture `.txt` from `test-data/synthetic/` → text appears in textarea → Anonimizuj → entities found.
- repeat for `.docx` (small synthetic fixture added under `test-data/fixtures/`)
- repeat for a text PDF fixture
- scanned-PDF fixture → ScannedPdfError UI shown, "Wklej tekst" works

Eval and bench are untouched.

## Open items deferred to plan stage

- Exact dropzone visual styling (existing CSS variables in `style.css`).
- Whether the file pill is clickable for "show metadata" tooltip (probably not in v1).
- Whether to surface `pageCount` anywhere in v1 (probably not).
- Where the e2e Playwright config lives and how it's wired into npm scripts.
