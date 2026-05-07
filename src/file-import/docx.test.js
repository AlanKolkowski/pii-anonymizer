import { extractDocx } from './docx.js';
import { ExtractionFailedError } from './errors.js';

function fakeMammoth(value) {
  return {
    extractRawText: async () => ({ value, messages: [] }),
  };
}

function fakeFile(name = 'a.docx', size = 100) {
  const buf = new Uint8Array(size);
  return new File([buf], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

describe('extractDocx', () => {
  it('returns mammoth raw text and meta', async () => {
    const file = fakeFile('contract.docx');
    const out = await extractDocx(file, { loadMammoth: async () => fakeMammoth('Hello world') });
    expect(out.text).toBe('Hello world');
    expect(out.meta).toEqual({
      filename: 'contract.docx',
      mimeType: file.type,
      sizeBytes: file.size,
    });
  });

  it('wraps mammoth errors in ExtractionFailedError', async () => {
    const broken = {
      extractRawText: () => Promise.reject(new Error('not a docx')),
    };
    await expect(
      extractDocx(fakeFile(), { loadMammoth: async () => broken })
    ).rejects.toBeInstanceOf(ExtractionFailedError);
  });

  it('wraps loader failures in ExtractionFailedError', async () => {
    await expect(
      extractDocx(fakeFile(), { loadMammoth: async () => { throw new Error('cdn down'); } })
    ).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
