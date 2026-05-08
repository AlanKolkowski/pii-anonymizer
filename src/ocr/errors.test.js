import {
  OcrError,
  WebNNUnavailableError,
  OcrFailedError,
  OcrCancelledError,
} from './errors.js';

describe('OCR errors', () => {
  it('all subclasses extend OcrError and Error', () => {
    expect(new WebNNUnavailableError('x')).toBeInstanceOf(OcrError);
    expect(new WebNNUnavailableError('x')).toBeInstanceOf(Error);
    expect(new OcrFailedError(new Error('x'))).toBeInstanceOf(OcrError);
    expect(new OcrCancelledError()).toBeInstanceOf(OcrError);
  });

  it('WebNNUnavailableError carries a message', () => {
    const err = new WebNNUnavailableError('webnn ep failed');
    expect(err.name).toBe('WebNNUnavailableError');
    expect(err.message).toContain('webnn ep failed');
  });

  it('OcrFailedError preserves cause', () => {
    const cause = new Error('boom');
    const err = new OcrFailedError(cause);
    expect(err.name).toBe('OcrFailedError');
    expect(err.cause).toBe(cause);
  });

  it('OcrCancelledError has a stable name and message', () => {
    const err = new OcrCancelledError();
    expect(err.name).toBe('OcrCancelledError');
    expect(err.message).toBe('OCR cancelled');
  });
});
