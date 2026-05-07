import { extractText, MAX_BYTES } from './index.js';
import {
  UnsupportedTypeError,
  FileTooLargeError,
} from './errors.js';

function makeFile(name, type, contentOrSize = 'hello') {
  if (typeof contentOrSize === 'number') {
    const buf = new Uint8Array(contentOrSize);
    return new File([buf], name, { type });
  }
  return new File([contentOrSize], name, { type });
}

describe('extractText dispatch', () => {
  it('routes .txt to the txt extractor', async () => {
    const file = makeFile('a.txt', 'text/plain', 'hi');
    const out = await extractText(file);
    expect(out.text).toBe('hi');
    expect(out.meta.filename).toBe('a.txt');
  });

  it('throws UnsupportedTypeError for unknown extensions', async () => {
    const file = makeFile('a.zip', 'application/zip', 'x');
    await expect(extractText(file)).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  it('throws FileTooLargeError when file.size > MAX_BYTES', async () => {
    const file = makeFile('a.txt', 'text/plain', MAX_BYTES + 1);
    await expect(extractText(file)).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('infers .txt from filename even when mime is empty', async () => {
    const file = makeFile('plain.txt', '', 'hi');
    const out = await extractText(file);
    expect(out.text).toBe('hi');
  });
});
