# Atrybucja komponentów zewnętrznych (Third-Party Notices)

Plik wymagany przez licencję Apache 2.0 (§4) i dobre obyczaje. Dotyczy
aplikacji desktopowej „Lokalny anonimizator" (fork
[wjarka/pii-anonymizer](https://github.com/wjarka/pii-anonymizer)).

## Projekt bazowy

| Komponent | Licencja | Źródło |
|---|---|---|
| pii-anonymizer (pii.tools) — Copyright 2026 pii.tools contributors | Apache-2.0 | https://github.com/wjarka/pii-anonymizer |

Fork zachowuje pełną funkcjonalność projektu bazowego; wykaz zmian względem
upstreamu opisuje `README.md` (sekcja „Zmiany względem upstreamu").

## Modele wbudowane w instalator (`resources/models/`)

| Model | Rola | Licencja | Pochodzenie |
|---|---|---|---|
| `wjarka/eu-pii-anonimization-pl` (wariant ONNX INT8, `onnx/model_quantized.onnx`) | NER PII, polski | Apache-2.0 | mirror redystrybucyjny modelu **bardsai/eu-pii-anonimization** autorstwa [bards.ai](https://bards.ai); pliki bajt-w-bajt identyczne z oryginałem |
| `wjarka/eu-pii-anonimization-multilang` (wariant ONNX INT8) | NER PII, wielojęzyczny | Apache-2.0 | mirror redystrybucyjny modelu **bardsai/eu-pii-anonimization-multilang** autorstwa bards.ai |
| baza obu powyższych: `FacebookAI/xlm-roberta-base` | architektura/wagi bazowe | MIT | https://huggingface.co/FacebookAI/xlm-roberta-base |
| `PP-OCRv5_mobile_det` (ONNX, tar) | OCR — detekcja tekstu | Apache-2.0 | projekt [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (PaddlePaddle) |
| `latin_PP-OCRv5_mobile_rec` (ONNX, tar) | OCR — rozpoznawanie (łacinka, polskie znaki) | Apache-2.0 | projekt PaddleOCR; konwersja ONNX dystrybuowana z projektem bazowym |

Sumy SHA-256 pobranych plików modelowych zapisuje `models/manifest.json`
(generowany przez `npm run desktop:fetch-models`).

## Środowisko uruchomieniowe i biblioteki kluczowe

| Komponent | Licencja | Uwagi |
|---|---|---|
| Electron (+ Chromium, Node.js) | MIT (+ licencje Chromium/Node) | teksty licencji dystrybuowane z binarką (`LICENSES.chromium.html`) |
| @huggingface/transformers (Transformers.js) | Apache-2.0 | inferencja NER |
| onnxruntime-web (pliki WASM w `vendor/ort/` i `vendor/ort-paddle/`) | MIT | teksty licencji kopiowane do `vendor/*/LICENSE.txt` przy buildzie |
| @paddleocr/paddleocr-js | Apache-2.0 | silnik OCR (SDK z wbudowanym OpenCV.js) |
| OpenCV.js (via @techstark/opencv-js, w pakiecie SDK PaddleOCR) | Apache-2.0 | |
| pdfjs-dist (PDF.js) + pliki WASM (`vendor/pdfjs/wasm/`) | Apache-2.0 | import PDF |
| mammoth | BSD-2-Clause | import DOCX |
| docx | MIT | eksport DOCX |
| pdf-lib | MIT | eksport PDF |
| **heic-to** (libheif 1.21.2 jako wasm2js) | **LGPL-3.0** | konwersja HEIC→JPEG; biblioteka używana bez modyfikacji, jako odrębny moduł npm. UWAGA licencyjna: LGPL w bundlu JS — odziedziczone po projekcie bazowym; do przeglądu prawnego przy dystrybucji komercyjnej (TODO(licencje)) |
| sentencex / sentencex-wasm | MIT | segmentacja zdań |
| WebMCP (`public/webmcp.js`, vendored) | wg upstreamu @jason.today/webmcp (MIT) | integracja MCP w rendererze |

## Fonty

Build desktopowy nie dołącza fontów Google (Inter, Instrument Serif,
JetBrains Mono) — odwołania do Google Fonts są usuwane z HTML, a UI korzysta
z fontów systemowych. TODO(parytet): self-hosting fontów (licencje OFL
pozwalają na dołączenie do pakietu).
