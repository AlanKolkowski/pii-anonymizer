export class OcrError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OcrError';
  }
}

export class WebNNUnavailableError extends OcrError {
  constructor(message) {
    super(message);
    this.name = 'WebNNUnavailableError';
  }
}

export class OcrFailedError extends OcrError {
  constructor(cause) {
    super(`OCR failed: ${cause?.message ?? cause}`);
    this.name = 'OcrFailedError';
    this.cause = cause;
  }
}

export class OcrCancelledError extends OcrError {
  constructor() {
    super('OCR cancelled');
    this.name = 'OcrCancelledError';
  }
}
