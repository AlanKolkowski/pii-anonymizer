import { describe, it, expect } from 'vitest';
import { openZip } from './zip-reader.js';
import { composeZip, ZipWriteError } from './zip-writer.js';
import { buildZip } from './test-helpers/zip-fixture.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function expectAsyncThrow(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected promise to reject, but it resolved');
}

describe('composeZip — round-trip with zero modifications is byte-identical per entry', () => {
  it('produces entries whose compressed bytes exactly match the source (store and deflate)', async () => {
    const sourceBytes = await buildZip([
      { name: '[Content_Types].xml', data: '<Types/>', method: 0 },
      { name: 'word/document.xml', data: '<w:document>Powód Jan Kowalski, Toruń 2026</w:document>', method: 8 },
      { name: 'word/media/image1.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), method: 8 },
    ]);
    const source = openZip(sourceBytes);

    const composed = await composeZip(source, {});
    const recomposed = openZip(composed);

    expect(recomposed.entries.map((e) => e.name)).toEqual(source.entries.map((e) => e.name));

    for (const entry of source.entries) {
      const before = source.extractRaw(entry.name);
      const after = recomposed.extractRaw(entry.name);
      expect(after.method).toBe(before.method);
      expect(after.uncompressedSize).toBe(before.uncompressedSize);
      expect(after.crc32).toBe(before.crc32);
      expect(after.compressedBytes).toEqual(before.compressedBytes);
    }
  });

  it('recovers identical decompressed content for every entry', async () => {
    const sourceBytes = await buildZip([
      { name: 'word/document.xml', data: 'Treść dokumentu z polskimi znakami: ąćęłńóśźż', method: 8 },
      { name: 'word/settings.xml', data: '<settings/>', method: 0 },
    ]);
    const composed = await composeZip(openZip(sourceBytes), {});
    const recomposed = openZip(composed);

    expect(decoder.decode(await recomposed.extract('word/document.xml'))).toBe(
      'Treść dokumentu z polskimi znakami: ąćęłńóśźż',
    );
    expect(decoder.decode(await recomposed.extract('word/settings.xml'))).toBe('<settings/>');
  });

  it('accepts a Map as well as a plain object for modifications', async () => {
    const sourceBytes = await buildZip([{ name: 'a.xml', data: 'x' }]);
    const source = openZip(sourceBytes);
    await expect(composeZip(source, new Map())).resolves.toBeInstanceOf(Uint8Array);
    await expect(composeZip(source, {})).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('composeZip — modified entries are recompressed, untouched ones stay verbatim', () => {
  it('replaces only the modified entry, leaving others byte-identical', async () => {
    const sourceBytes = await buildZip([
      { name: 'word/document.xml', data: '<w:t>[PERSON_NAME_1]</w:t>', method: 8 },
      { name: 'word/settings.xml', data: '<settings untouched="true"/>', method: 8 },
    ]);
    const source = openZip(sourceBytes);
    const settingsBefore = source.extractRaw('word/settings.xml');

    const newDocumentXml = encoder.encode('<w:t>Jan Kowalski</w:t>');
    const composed = await composeZip(source, { 'word/document.xml': newDocumentXml });
    const recomposed = openZip(composed);

    expect(decoder.decode(await recomposed.extract('word/document.xml'))).toBe('<w:t>Jan Kowalski</w:t>');

    const settingsAfter = recomposed.extractRaw('word/settings.xml');
    expect(settingsAfter.compressedBytes).toEqual(settingsBefore.compressedBytes);
    expect(settingsAfter.crc32).toBe(settingsBefore.crc32);
  });

  it('preserves the original method (store or deflate) when recompressing a modified entry', async () => {
    const sourceBytes = await buildZip([
      { name: 'stored.xml', data: 'old stored content', method: 0 },
      { name: 'deflated.xml', data: 'old deflated content', method: 8 },
    ]);
    const source = openZip(sourceBytes);
    const composed = await composeZip(source, {
      'stored.xml': encoder.encode('new stored'),
      'deflated.xml': encoder.encode('new deflated'),
    });
    const recomposed = openZip(composed);

    expect(recomposed.extractRaw('stored.xml').method).toBe(0);
    expect(recomposed.extractRaw('deflated.xml').method).toBe(8);
    expect(decoder.decode(await recomposed.extract('stored.xml'))).toBe('new stored');
    expect(decoder.decode(await recomposed.extract('deflated.xml'))).toBe('new deflated');
  });

  it('computes a correct fresh CRC-32 for modified content (recomposed entry re-verifies cleanly)', async () => {
    const source = openZip(await buildZip([{ name: 'a.xml', data: 'anything' }]));
    const composed = await composeZip(source, { 'a.xml': encoder.encode('brand new content, different length') });
    const recomposed = openZip(composed);
    // extract() independently re-verifies CRC-32 against the central
    // directory — resolving without throwing proves the fresh CRC is right.
    await expect(recomposed.extract('a.xml')).resolves.toBeDefined();
  });
});

describe('composeZip — zero new entries invariant', () => {
  it('rejects a modification targeting a name absent from the source', async () => {
    const source = openZip(await buildZip([{ name: 'a.xml', data: 'x' }]));
    const err = await expectAsyncThrow(
      composeZip(source, { 'b.xml': encoder.encode('should not be allowed') }),
    );
    expect(err).toBeInstanceOf(ZipWriteError);
    expect(err.code).toBe('UNKNOWN_MODIFICATION_TARGET');
  });
});

// No Word/LibreOffice available in this environment to literally open the
// result (DOCX-REBUILD-DESIGN.md MD2 acceptance criterion) — see
// NIGHT-NOTES.md. mammoth is an independent, already-in-repo OOXML parser
// (used for the app's own DOCX import), so feeding it a hand-built minimal
// .docx recomposed through composeZip is the strongest automated proxy
// available for "a real Word-compatible reader accepts this file".
const CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';
const RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';
function documentXml(text) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>`
    + '</w:document>';
}

// mammoth.extractRawText wants { buffer } under Node (this test's runtime) —
// its browser build accepts { arrayBuffer } instead, which is what the app's
// own src/file-import/docx.js uses; both feed the same JSZip.loadAsync.
describe('composeZip — mammoth (independent OOXML parser) accepts the recomposed file', () => {
  it('parses a zero-modification round trip and recovers the original paragraph text', async () => {
    const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
    const sourceBytes = await buildZip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES_XML, method: 0 },
      { name: '_rels/.rels', data: RELS_XML, method: 0 },
      { name: 'word/document.xml', data: documentXml('Hello from a hand-built docx'), method: 8 },
    ]);
    const composed = await composeZip(openZip(sourceBytes), {});

    const result = await mammoth.extractRawText({ buffer: composed });
    expect(result.value.trim()).toBe('Hello from a hand-built docx');
  });

  it('parses a recomposed file with a modified document.xml and recovers the new text', async () => {
    const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
    const sourceBytes = await buildZip([
      { name: '[Content_Types].xml', data: CONTENT_TYPES_XML, method: 0 },
      { name: '_rels/.rels', data: RELS_XML, method: 0 },
      { name: 'word/document.xml', data: documentXml('[PERSON_NAME_1] wnosi o zapłatę.'), method: 8 },
    ]);
    const source = openZip(sourceBytes);
    const newDocXml = encoder.encode(documentXml('Jan Kowalski wnosi o zapłatę.'));
    const composed = await composeZip(source, { 'word/document.xml': newDocXml });

    const result = await mammoth.extractRawText({ buffer: composed });
    expect(result.value.trim()).toBe('Jan Kowalski wnosi o zapłatę.');
  });
});

describe('composeZip — output is itself a well-formed, re-openable ZIP', () => {
  it('round-trips through openZip repeatedly without accumulating drift', async () => {
    const sourceBytes = await buildZip([
      { name: 'a.xml', data: 'first' },
      { name: 'b.xml', data: 'second', method: 0 },
      { name: 'c.xml', data: 'third' },
    ]);
    let bytes = sourceBytes;
    for (let i = 0; i < 3; i++) {
      const zip = openZip(bytes);
      bytes = await composeZip(zip, {});
    }
    const finalZip = openZip(bytes);
    expect(decoder.decode(await finalZip.extract('a.xml'))).toBe('first');
    expect(decoder.decode(await finalZip.extract('b.xml'))).toBe('second');
    expect(decoder.decode(await finalZip.extract('c.xml'))).toBe('third');
  });
});
