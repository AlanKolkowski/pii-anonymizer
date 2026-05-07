export class FileImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileImportError';
  }
}

export class UnsupportedTypeError extends FileImportError {
  constructor(mimeType, filename) {
    super(`Unsupported file type: ${mimeType || '(none)'} (${filename})`);
    this.name = 'UnsupportedTypeError';
    this.mimeType = mimeType;
    this.filename = filename;
  }
}

export class FileTooLargeError extends FileImportError {
  constructor(sizeBytes, limitBytes) {
    super(`File too large: ${sizeBytes} > ${limitBytes}`);
    this.name = 'FileTooLargeError';
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

export class ScannedPdfError extends FileImportError {
  constructor(pageCount) {
    super(`PDF appears to be scanned (no extractable text); pageCount=${pageCount}`);
    this.name = 'ScannedPdfError';
    this.pageCount = pageCount;
  }
}

export class ExtractionFailedError extends FileImportError {
  constructor(format, cause) {
    super(`Extraction failed for ${format}: ${cause?.message ?? cause}`);
    this.name = 'ExtractionFailedError';
    this.format = format;
    this.cause = cause;
  }
}
