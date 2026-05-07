import { extractTxt } from './txt.js';
import { ExtractionFailedError } from './errors.js';

function fileFrom(text, name = 'a.txt', type = 'text/plain') {
  return new File([text], name, { type });
}

describe('extractTxt', () => {
  it('returns text and meta for a UTF-8 file', async () => {
    const file = fileFrom('Jan Kowalski mieszka w Krakowie.', 'doc.txt', 'text/plain');
    const result = await extractTxt(file);
    expect(result.text).toBe('Jan Kowalski mieszka w Krakowie.');
    expect(result.meta).toEqual({
      filename: 'doc.txt',
      mimeType: 'text/plain',
      sizeBytes: file.size,
    });
  });

  it('strips a UTF-8 BOM from the start', async () => {
    const bom = '﻿';
    const file = fileFrom(bom + 'hello', 'b.txt');
    const result = await extractTxt(file);
    expect(result.text).toBe('hello');
  });

  it('does not normalize line endings (downstream pipeline owns that)', async () => {
    const file = fileFrom('a\r\nb\nc', 'c.txt');
    const result = await extractTxt(file);
    expect(result.text).toBe('a\r\nb\nc');
  });

  it('wraps File.text() failures in ExtractionFailedError', async () => {
    const broken = {
      name: 'x.txt',
      type: 'text/plain',
      size: 4,
      text: () => Promise.reject(new Error('boom')),
    };
    await expect(extractTxt(broken)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
