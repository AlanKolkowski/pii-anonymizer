import { extractTxt } from './txt.js';
import { ExtractionFailedError } from './errors.js';

function fileFrom(text, name = 'a.txt', type = 'text/plain') {
  return new File([text], name, { type });
}

const CP1250_POLISH = {
  'ą': 0xB9, 'ć': 0xE6, 'ę': 0xEA, 'ł': 0xB3, 'ń': 0xF1, 'ó': 0xF3,
  'ś': 0x9C, 'ź': 0x9F, 'ż': 0xBF,
  'Ą': 0xA5, 'Ć': 0xC6, 'Ę': 0xCA, 'Ł': 0xA3, 'Ń': 0xD1, 'Ó': 0xD3,
  'Ś': 0x8C, 'Ź': 0x8F, 'Ż': 0xAF,
};
const ISO_8859_2_POLISH = {
  'ą': 0xB1, 'ć': 0xE6, 'ę': 0xEA, 'ł': 0xB3, 'ń': 0xF1, 'ó': 0xF3,
  'ś': 0xB6, 'ź': 0xBC, 'ż': 0xBF,
  'Ą': 0xA1, 'Ć': 0xC6, 'Ę': 0xCA, 'Ł': 0xA3, 'Ń': 0xD1, 'Ó': 0xD3,
  'Ś': 0xA6, 'Ź': 0xAC, 'Ż': 0xAF,
};

function legacyEncode(str, map) {
  const bytes = [];
  for (const ch of str) {
    if (ch in map) bytes.push(map[ch]);
    else bytes.push(ch.charCodeAt(0));
  }
  return new Uint8Array(bytes);
}

function fileFromBytes(bytes, name = 'a.txt', type = 'text/plain') {
  return new File([bytes], name, { type });
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

  it('decodes cp1250 (windows-1250) bytes with Polish diacritics', async () => {
    const phrase = 'Łukasz Wójcik, ul. Łąkowa';
    const bytes = legacyEncode(phrase, CP1250_POLISH);
    const result = await extractTxt(fileFromBytes(bytes, 'cp1250.txt'));
    expect(result.text).toBe(phrase);
  });

  it('decodes iso-8859-2 bytes with Polish diacritics', async () => {
    const phrase = 'Łukasz Wójcik, ul. Łąkowa';
    const bytes = legacyEncode(phrase, ISO_8859_2_POLISH);
    const result = await extractTxt(fileFromBytes(bytes, 'iso.txt'));
    expect(result.text).toBe(phrase);
  });

  it('decodes UTF-16LE with BOM and strips the BOM', async () => {
    const phrase = 'Zażółć gęślą jaźń';
    const codes = new Uint8Array(phrase.length * 2 + 2);
    codes[0] = 0xff;
    codes[1] = 0xfe;
    for (let i = 0; i < phrase.length; i++) {
      const code = phrase.charCodeAt(i);
      codes[2 + i * 2] = code & 0xff;
      codes[2 + i * 2 + 1] = (code >> 8) & 0xff;
    }
    const result = await extractTxt(fileFromBytes(codes, 'utf16.txt'));
    expect(result.text).toBe(phrase);
    expect(result.text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('decodes valid UTF-8 with Polish diacritics', async () => {
    const phrase = 'Żółć i świder';
    const result = await extractTxt(fileFrom(phrase, 'utf8.txt'));
    expect(result.text).toBe(phrase);
  });
});
