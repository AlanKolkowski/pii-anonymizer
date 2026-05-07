import {
  UnsupportedTypeError,
  FileTooLargeError,
  ScannedPdfError,
  ExtractionFailedError,
  FileImportError,
} from './errors.js';

describe('file-import errors', () => {
  it('UnsupportedTypeError carries mimeType and filename', () => {
    const e = new UnsupportedTypeError('application/zip', 'a.zip');
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.mimeType).toBe('application/zip');
    expect(e.filename).toBe('a.zip');
    expect(e.name).toBe('UnsupportedTypeError');
  });

  it('FileTooLargeError carries actual and limit bytes', () => {
    const e = new FileTooLargeError(30_000_000, 25_000_000);
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.sizeBytes).toBe(30_000_000);
    expect(e.limitBytes).toBe(25_000_000);
    expect(e.name).toBe('FileTooLargeError');
  });

  it('ScannedPdfError exposes pageCount', () => {
    const e = new ScannedPdfError(12);
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.pageCount).toBe(12);
    expect(e.name).toBe('ScannedPdfError');
  });

  it('ExtractionFailedError wraps the underlying cause', () => {
    const cause = new Error('pdf.js exploded');
    const e = new ExtractionFailedError('pdf', cause);
    expect(e).toBeInstanceOf(FileImportError);
    expect(e.format).toBe('pdf');
    expect(e.cause).toBe(cause);
    expect(e.name).toBe('ExtractionFailedError');
  });
});
