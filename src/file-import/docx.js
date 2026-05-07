import { ExtractionFailedError } from './errors.js';

async function defaultLoadMammoth() {
  const mod = await import('mammoth');
  return mod.default ?? mod;
}

export async function extractDocx(file, deps = {}) {
  const loadMammoth = deps.loadMammoth ?? defaultLoadMammoth;
  let mammoth;
  let buf;
  try {
    [mammoth, buf] = await Promise.all([
      loadMammoth(),
      file.arrayBuffer(),
    ]);
  } catch (err) {
    throw new ExtractionFailedError('docx', err);
  }
  let value;
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    value = result.value ?? '';
  } catch (err) {
    throw new ExtractionFailedError('docx', err);
  }
  return {
    text: value,
    meta: {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  };
}
