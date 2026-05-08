// OCR engine identity used by file-import meta.
export const ENGINE = 'paddleocr-v5';
export const CACHE_KEY = `ocr-${ENGINE}`;

// PaddleOCR's default rec model is Chinese+English. We override it with the
// Latin PP-OCRv5 mobile recognizer (ONNX-converted from
// PaddlePaddle/latin_PP-OCRv5_mobile_rec) so Polish diacritics work. The tar
// is served from public/ocr-models/ — see vite.config.js's no-fallback list.
export const TEXT_RECOGNITION_MODEL_NAME = 'latin_PP-OCRv5_mobile_rec';
export const TEXT_RECOGNITION_MODEL_URL =
  `${import.meta.env.BASE_URL}ocr-models/${TEXT_RECOGNITION_MODEL_NAME}.tar`;
