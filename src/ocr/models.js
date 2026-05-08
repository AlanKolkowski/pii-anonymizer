// OCR engine identity used by file-import meta. The PaddleOCR JS SDK
// (@paddleocr/paddleocr-js) ships its own model loading, so we don't pin our
// own URLs here yet — the default Chinese rec model is downloaded by the SDK
// and wired up. Polish coverage is added in a follow-up by overriding
// `textRecognitionModelAsset.url` once we have an ONNX-converted Latin model
// hosted somewhere we control.
export const ENGINE = 'paddleocr-v5';
export const CACHE_KEY = `ocr-${ENGINE}`;
