import { extractTxt } from './txt.js';
import { extractDocx } from './docx.js';
import { extractPdf } from './pdf.js';
import { extractImage } from './image.js';
import {
  UnsupportedTypeError,
  FileTooLargeError,
} from './errors.js';

export const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSION_TO_FORMAT = {
  txt: 'txt',
  docx: 'docx',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  heic: 'image',
  heif: 'image',
};

const MIME_TO_FORMAT = {
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
};

const EXTRACTORS = {
  txt: extractTxt,
  docx: extractDocx,
  pdf: extractPdf,
  image: extractImage,
};

function inferFormat(file) {
  const name = file.name ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (EXTENSION_TO_FORMAT[ext]) return EXTENSION_TO_FORMAT[ext];
  if (file.type && MIME_TO_FORMAT[file.type]) return MIME_TO_FORMAT[file.type];
  return null;
}

export async function extractText(file) {
  if (file.size > MAX_BYTES) {
    throw new FileTooLargeError(file.size, MAX_BYTES);
  }
  const format = inferFormat(file);
  if (!format) {
    throw new UnsupportedTypeError(file.type, file.name);
  }
  return EXTRACTORS[format](file);
}
