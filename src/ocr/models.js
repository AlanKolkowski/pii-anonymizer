// Pinned PP-OCRv4 assets. See src/ocr/SPIKE.md for the decision record.
export const PADDLE_VERSION = 'PP-OCRv4-2024.07-multilingual';

export const PADDLE_DET_URL = '/ocr/models/PP-OCRv4_det_infer.onnx';
export const PADDLE_REC_URL = '/ocr/models/PP-OCRv4_rec_multilingual_infer.onnx';
export const PADDLE_DICT_URL = '/ocr/models/latin_dict.txt';

// Cache key versioned with the model assets so a model swap invalidates clients.
export const CACHE_KEY = `ocr-paddleocr-v4-${PADDLE_VERSION}`;

// EP preference order. WebNN first; WASM as the dependable fallback.
export const EXECUTION_PROVIDERS = ['webnn', 'wasm'];
