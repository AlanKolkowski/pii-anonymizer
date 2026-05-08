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

  it('routes .docx to the docx extractor', async () => {
    const file = new File(
      [new Uint8Array(8)],
      'a.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    );
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('infers .docx from filename when mime is empty', async () => {
    const file = new File([new Uint8Array(8)], 'b.docx', { type: '' });
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('routes .pdf to the pdf extractor', async () => {
    const file = new File([new Uint8Array(8)], 'a.pdf', { type: 'application/pdf' });
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});

describe('extractText dispatch — images', () => {
  it('routes .png to the image extractor', async () => {
    const file = new File([new Uint8Array(8)], 'a.png', { type: 'image/png' });
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('routes .jpg to the image extractor', async () => {
    const file = new File([new Uint8Array(8)], 'a.jpg', { type: 'image/jpeg' });
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('routes .heic to the image extractor by extension', async () => {
    const file = new File([new Uint8Array(8)], 'a.heic', { type: '' });
    const { ExtractionFailedError } = await import('./errors.js');
    await expect(extractText(file)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
