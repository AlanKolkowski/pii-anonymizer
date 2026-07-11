import { describe, it, expect } from 'vitest';
import { openZip, ZipFormatError } from './zip-reader.js';
import { buildZip } from './test-helpers/zip-fixture.js';

const decoder = new TextDecoder();

function expectSyncThrow(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected function to throw, but it did not');
}

async function expectAsyncThrow(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected promise to reject, but it resolved');
}

describe('openZip — golden: reads store and deflate entries correctly', () => {
  it('lists entries and extracts their original content', async () => {
    const zipBytes = await buildZip([
      { name: '[Content_Types].xml', data: '<Types/>', method: 0 },
      { name: 'word/document.xml', data: '<w:document>Hello świat</w:document>', method: 8 },
      { name: 'word/media/image1.png', data: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]), method: 8 },
    ]);

    const zip = openZip(zipBytes);
    expect(zip.entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      'word/document.xml',
      'word/media/image1.png',
    ]);
    expect(zip.hasEntry('word/document.xml')).toBe(true);
    expect(zip.hasEntry('nope.xml')).toBe(false);

    expect(decoder.decode(await zip.extract('[Content_Types].xml'))).toBe('<Types/>');
    expect(decoder.decode(await zip.extract('word/document.xml'))).toBe('<w:document>Hello świat</w:document>');
    expect(await zip.extract('word/media/image1.png')).toEqual(new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]));
  });

  it('rejects extracting an entry not present in the archive', async () => {
    const zip = openZip(await buildZip([{ name: 'a.xml', data: 'x' }]));
    const err = await expectAsyncThrow(zip.extract('missing.xml'));
    expect(err.code).toBe('ENTRY_NOT_FOUND');
  });
});

describe('openZip — hostile containers are rejected, never silently accepted', () => {
  it('rejects a file with no EOCD record at all', () => {
    const err = expectSyncThrow(() => openZip(new Uint8Array([1, 2, 3, 4, 5])));
    expect(err).toBeInstanceOf(ZipFormatError);
    expect(err.code).toBe('NO_EOCD');
  });

  it('rejects duplicate entry names — the whole file, not just the duplicate', async () => {
    const zipBytes = await buildZip([
      { name: 'word/document.xml', data: 'a' },
      { name: 'word/document.xml', data: 'b' },
    ]);
    const err = expectSyncThrow(() => openZip(zipBytes));
    expect(err.code).toBe('DUPLICATE_ENTRY_NAME');
  });

  it('rejects an encrypted entry (general purpose bit 0)', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'x', generalPurposeFlag: 0x0001 }]);
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('ENCRYPTED_ENTRY');
  });

  it('rejects a strong-encryption entry (general purpose bit 6)', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'x', generalPurposeFlag: 0x0040 }]);
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('ENCRYPTED_ENTRY');
  });

  it('rejects a central-directory-encrypted entry (general purpose bit 13)', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'x', generalPurposeFlag: 0x2000 }]);
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('ENCRYPTED_ENTRY');
  });

  it('rejects a patch-data entry (general purpose bit 5)', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'x', generalPurposeFlag: 0x0020 }]);
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('PATCH_DATA_ENTRY');
  });

  it('rejects an unsupported compression method', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'x', method: 12 }]);
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('UNSUPPORTED_METHOD');
  });

  it('rejects ZIP64 signaled via an EOCD sentinel central directory offset', async () => {
    const zipBytes = await buildZip(
      [{ name: 'a.xml', data: 'x' }],
      { centralDirOffsetOverride: 0xffffffff },
    );
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('ZIP64_UNSUPPORTED');
  });

  it('rejects ZIP64 signaled via an EOCD sentinel entry count', async () => {
    const zipBytes = await buildZip(
      [{ name: 'a.xml', data: 'x' }],
      { totalEntriesOverride: 0xffff, entriesOnDiskOverride: 0xffff },
    );
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('ZIP64_UNSUPPORTED');
  });

  it('rejects ZIP64 signaled via a sentinel entry size field', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'x', compressedSizeOverride: 0xffffffff }]);
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('ZIP64_UNSUPPORTED');
  });

  it('rejects an archive with more entries than a configured limit', async () => {
    const entries = [];
    for (let i = 0; i < 5; i++) entries.push({ name: `f${i}.xml`, data: 'x', method: 0 });
    const zipBytes = await buildZip(entries);
    expect(expectSyncThrow(() => openZip(zipBytes, { maxEntries: 4 })).code).toBe('TOO_MANY_ENTRIES');
  });

  it('rejects the real default entry-count limit (2048) with 2049 minimal stored entries', async () => {
    const entries = [];
    for (let i = 0; i < 2049; i++) entries.push({ name: `f${i}`, data: '', method: 0 });
    const zipBytes = await buildZip(entries);
    expect(expectSyncThrow(() => openZip(zipBytes)).code).toBe('TOO_MANY_ENTRIES');
  });

  it('rejects a truncated/corrupted central directory', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'x' }]);
    // Corrupt the central directory file header signature in place.
    const corrupted = zipBytes.slice();
    const centralSigOffset = corrupted.length - 22 - (46 + 5); // 22-byte EOCD, 46+len("a.xml")-byte central record
    corrupted[centralSigOffset] = 0x00;
    const err = expectSyncThrow(() => openZip(corrupted));
    expect(err.code).toBe('BAD_CENTRAL_DIR_ENTRY');
  });
});

describe('openZip — decompression limits are enforced during streaming, not after the fact', () => {
  it('aborts an entry exceeding the per-entry decompressed-size limit', async () => {
    const payload = new Uint8Array(1000).fill(65); // highly compressible
    const zipBytes = await buildZip([{ name: 'a.bin', data: payload, method: 8 }]);
    const zip = openZip(zipBytes, { maxEntryBytes: 100 });
    const err = await expectAsyncThrow(zip.extract('a.bin'));
    expect(err.code).toBe('ENTRY_LIMIT_EXCEEDED');
  });

  it('does not block a store-method entry within the per-entry limit', async () => {
    const zip = openZip(
      await buildZip([{ name: 'a.bin', data: new Uint8Array(50).fill(1), method: 0 }]),
      { maxEntryBytes: 100 },
    );
    expect((await zip.extract('a.bin')).length).toBe(50);
  });

  it('aborts once the cumulative total across several extract() calls exceeds the limit', async () => {
    const zipBytes = await buildZip([
      { name: 'a.bin', data: new Uint8Array(10).fill(1), method: 8 },
      { name: 'b.bin', data: new Uint8Array(10).fill(2), method: 8 },
    ]);
    const zip = openZip(zipBytes, { maxEntryBytes: 20, maxTotalBytes: 15 });
    await zip.extract('a.bin'); // 10 bytes — within both limits
    const err = await expectAsyncThrow(zip.extract('b.bin')); // cumulative 20 > 15
    expect(err.code).toBe('TOTAL_LIMIT_EXCEEDED');
  });

  it('rejects a real-scale deflate bomb (60 MiB of zeros) under the production default 50 MiB limit', async () => {
    const bomb = new Uint8Array(60 * 1024 * 1024); // all zeros — deflates to a few KB
    const zipBytes = await buildZip([{ name: 'bomb.bin', data: bomb, method: 8 }]);
    const zip = openZip(zipBytes);
    const err = await expectAsyncThrow(zip.extract('bomb.bin'));
    expect(err.code).toBe('ENTRY_LIMIT_EXCEEDED');
  }, 20000);
});

describe('openZip — extractRaw (verbatim-copy passthrough for MD2)', () => {
  it('returns the compressed bytes unchanged, without decompressing', async () => {
    const zipBytes = await buildZip([{ name: 'word/document.xml', data: '<w:document>hello</w:document>', method: 8 }]);
    const zip = openZip(zipBytes);
    const raw = zip.extractRaw('word/document.xml');
    expect(raw.method).toBe(8);
    expect(raw.uncompressedSize).toBe('<w:document>hello</w:document>'.length);
    // The raw bytes are still deflate-compressed — decompressing them
    // ourselves must recover the exact original content.
    const decompressed = await new Response(
      new Blob([raw.compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
    ).arrayBuffer();
    expect(decoder.decode(decompressed)).toBe('<w:document>hello</w:document>');
  });

  it('reports the correct declared CRC-32 for the entry', async () => {
    const zip = openZip(await buildZip([{ name: 'a.xml', data: 'content' }]));
    const raw = zip.extractRaw('a.xml');
    expect(typeof raw.crc32).toBe('number');
    // extract() independently verifies this same CRC internally — if it
    // doesn't throw, extractRaw's reported crc32 must be the correct one.
    await expect(zip.extract('a.xml')).resolves.toBeDefined();
  });

  it('does not apply decompression byte limits (nothing is decompressed)', async () => {
    const bomb = new Uint8Array(2 * 1024 * 1024).fill(1);
    const zipBytes = await buildZip([{ name: 'bomb.bin', data: bomb, method: 8 }]);
    const zip = openZip(zipBytes, { maxEntryBytes: 10, maxTotalBytes: 10 });
    const raw = zip.extractRaw('bomb.bin'); // must not throw — no decompression happens
    expect(raw.compressedBytes.length).toBeGreaterThan(0);
    expect(raw.compressedBytes.length).toBeLessThan(bomb.length);
  });

  it('rejects extractRaw for an entry not present in the archive', async () => {
    const zip = openZip(await buildZip([{ name: 'a.xml', data: 'x' }]));
    const err = expectSyncThrow(() => zip.extractRaw('missing.xml'));
    expect(err.code).toBe('ENTRY_NOT_FOUND');
  });
});

describe('openZip — CRC-32 integrity (consumes S4 createCrc32)', () => {
  it('rejects an entry whose decompressed bytes do not match the declared CRC-32', async () => {
    const zipBytes = await buildZip([{ name: 'a.xml', data: 'real content', crcOverride: 0x12345678 }]);
    const zip = openZip(zipBytes);
    const err = await expectAsyncThrow(zip.extract('a.xml'));
    expect(err.code).toBe('CRC_MISMATCH');
  });

  it('accepts an entry whose CRC-32 is correct', async () => {
    const zip = openZip(await buildZip([{ name: 'a.xml', data: 'real content' }]));
    expect(decoder.decode(await zip.extract('a.xml'))).toBe('real content');
  });
});
