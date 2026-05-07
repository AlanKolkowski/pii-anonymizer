# e2e fixtures

These files exercise the file upload flow end-to-end. Binary fixtures
(`.docx`, `.pdf`) are committed; `sample.txt` is the source of truth.

## Files

- `sample.txt` — plain UTF-8 source. Generators read this.
- `sample.docx` — same content, generated from sample.txt.
- `sample-text.pdf` — same content, has extractable text on every page.
- `sample-scanned.pdf` — image-only PDF (filled rectangles, no text glyphs).
  Verifies the scan-detection heuristic.

## Regenerate

If `sample.txt` changes, regenerate the binary fixtures:

```bash
node scripts/build-e2e-fixtures.js
```

The generator uses `pdf-lib` and `docx` (devDependencies). Avoid Polish
diacritics in `sample.txt` — pdf-lib's bundled WinAnsi-only fonts can't
encode them. The model still detects PII just fine without diacritics.

## Synthetic data

These fixtures are synthetic. Do not include real PII.
