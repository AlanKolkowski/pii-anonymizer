import { ExtractionFailedError } from './errors.js';

const POLISH_DIACRITICS = 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ';

function scorePolishDiacritics(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (POLISH_DIACRITICS.includes(text[i])) count++;
  }
  return count;
}

function decodeLegacyPolish(bytes) {
  const cp1250 = new TextDecoder('windows-1250').decode(bytes);
  const iso88592 = new TextDecoder('iso-8859-2').decode(bytes);
  return scorePolishDiacritics(iso88592) > scorePolishDiacritics(cp1250)
    ? iso88592
    : cp1250;
}

export async function extractTxt(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    throw new ExtractionFailedError('txt', err);
  }

  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(bytes);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(bytes);
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = decodeLegacyPolish(bytes);
    }
  }

  return {
    text,
    meta: {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  };
}
