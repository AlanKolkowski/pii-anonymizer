import { ExtractionFailedError } from './errors.js';

export async function extractTxt(file) {
  let raw;
  try {
    raw = await file.text();
  } catch (err) {
    throw new ExtractionFailedError('txt', err);
  }
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return {
    text,
    meta: {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  };
}
