import {
  FileImportError,
  UnsupportedTypeError,
  FileTooLargeError,
  ExtractionFailedError,
  WebNNUnavailableError,
  OcrFailedError,
  OcrCancelledError,
} from './errors.js';

describe('file-import errors', () => {
  it('classes all extend Error', () => {
    expect(new UnsupportedTypeError('a', 'b')).toBeInstanceOf(Error);
    expect(new FileTooLargeError(1, 2)).toBeInstanceOf(Error);
    expect(new ExtractionFailedError('pdf', new Error('x'))).toBeInstanceOf(Error);
    expect(new WebNNUnavailableError('x')).toBeInstanceOf(Error);
    expect(new OcrFailedError(new Error('x'))).toBeInstanceOf(Error);
    expect(new OcrCancelledError()).toBeInstanceOf(Error);
  });

  it('re-exports do not re-define OCR errors (identity check)', async () => {
    const ocr = await import('../ocr/errors.js');
    expect(WebNNUnavailableError).toBe(ocr.WebNNUnavailableError);
    expect(OcrFailedError).toBe(ocr.OcrFailedError);
    expect(OcrCancelledError).toBe(ocr.OcrCancelledError);
  });

  it('does not export ScannedPdfError anymore', async () => {
    const mod = await import('./errors.js');
    expect(mod.ScannedPdfError).toBeUndefined();
  });
});
