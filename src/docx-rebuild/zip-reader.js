// Untrusted-ZIP-container reader (DOCX-REBUILD-DESIGN.md MD1, §9.2). A .docx
// from an AI is treated exactly like any Z3 document: hostile ZIP, hostile
// compression. This module only ever reads memory it already owns — nothing
// is written to disk, so zip-slip does not exist here by construction (entry
// names are plain object keys, never paths).
//
// Trust model: the CENTRAL DIRECTORY is the only source of truth for name,
// method, sizes and CRC. Local file headers are read only to locate where an
// entry's data starts (skip past its own name+extra fields) — their own
// size/CRC fields are never trusted, which is also why an entry using the
// general-purpose "data descriptor" bit (sizes trail the data instead of
// sitting in the local header) needs no special handling: we never look at
// the local header's size fields in the first place.
import { createCrc32 } from '../export/crc32.js';

export class ZipFormatError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ZipFormatError';
    this.code = code;
  }
}

const DEFAULT_MAX_ENTRIES = 2048;
const DEFAULT_MAX_ENTRY_BYTES = 50 * 1024 * 1024; // 50 MiB, per entry, after decompression
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MiB, summed across every extract() call

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_FIXED_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

// General-purpose bit flag bits (APPNOTE.TXT §4.4.4).
const GPBF_ENCRYPTED = 0x0001;
const GPBF_PATCH_DATA = 0x0020; // "the file is compressed patched data"
const GPBF_STRONG_ENCRYPTION = 0x0040;
const GPBF_CENTRAL_DIR_ENCRYPTED = 0x2000;
const GPBF_ANY_ENCRYPTION = GPBF_ENCRYPTED | GPBF_STRONG_ENCRYPTION | GPBF_CENTRAL_DIR_ENCRYPTED;

const SENTINEL_16 = 0xffff;
const SENTINEL_32 = 0xffffffff;

function fail(message, code) {
  throw new ZipFormatError(message, code);
}

function findEndOfCentralDirectory(bytes) {
  const maxScan = Math.min(bytes.length, EOCD_FIXED_SIZE + EOCD_MAX_COMMENT);
  const searchFloor = bytes.length - maxScan;
  for (let i = bytes.length - EOCD_FIXED_SIZE; i >= searchFloor; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

function parseCentralDirectory(bytes, view, limits) {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset === -1) {
    fail('Nie znaleziono rekordu końca katalogu centralnego (EOCD) — nieprawidłowy plik ZIP.', 'NO_EOCD');
  }
  if (view.getUint32(eocdOffset, true) !== EOCD_SIGNATURE) {
    fail('Uszkodzony rekord EOCD.', 'BAD_EOCD');
  }

  if (eocdOffset >= 20 && view.getUint32(eocdOffset - 20, true) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    fail('Wykryto ZIP64 (lokator EOCD64) — format nieobsługiwany.', 'ZIP64_UNSUPPORTED');
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirDisk = view.getUint16(eocdOffset + 6, true);
  const entriesThisDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  if (
    entriesThisDisk === SENTINEL_16 || totalEntries === SENTINEL_16 ||
    centralDirSize === SENTINEL_32 || centralDirOffset === SENTINEL_32
  ) {
    fail('Wykryto ZIP64 (wartości-wartowniki w EOCD) — format nieobsługiwany.', 'ZIP64_UNSUPPORTED');
  }
  if (diskNumber !== 0 || centralDirDisk !== 0 || entriesThisDisk !== totalEntries) {
    fail('Archiwum wieloczęściowe (multi-disk ZIP) nieobsługiwane.', 'MULTI_DISK_UNSUPPORTED');
  }
  if (totalEntries > limits.maxEntries) {
    fail(`Za dużo wpisów w archiwum (${totalEntries} > ${limits.maxEntries}).`, 'TOO_MANY_ENTRIES');
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries = [];
  const namesSeen = new Set();
  let cursor = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_DIR_SIGNATURE) {
      fail('Uszkodzony katalog centralny (zły nagłówek wpisu).', 'BAD_CENTRAL_DIR_ENTRY');
    }

    const generalPurposeFlag = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32Declared = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (generalPurposeFlag & GPBF_ANY_ENCRYPTION) {
      fail('Wpis archiwum jest zaszyfrowany — nieobsługiwane.', 'ENCRYPTED_ENTRY');
    }
    if (generalPurposeFlag & GPBF_PATCH_DATA) {
      fail('Wpis archiwum to skompresowane dane patch — nieobsługiwane.', 'PATCH_DATA_ENTRY');
    }
    if (method !== 0 && method !== 8) {
      fail(`Nieobsługiwana metoda kompresji (${method}) — dozwolone wyłącznie store (0) i deflate (8).`, 'UNSUPPORTED_METHOD');
    }
    if (compressedSize === SENTINEL_32 || uncompressedSize === SENTINEL_32 || localHeaderOffset === SENTINEL_32) {
      fail('Wykryto ZIP64 (wartownik rozmiaru wpisu) — format nieobsługiwany.', 'ZIP64_UNSUPPORTED');
    }

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > bytes.length) {
      fail('Uszkodzony katalog centralny (nazwa poza zakresem pliku).', 'BAD_CENTRAL_DIR_ENTRY');
    }
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));

    if (namesSeen.has(name)) {
      fail(`Zduplikowana nazwa wpisu w archiwum: ${name}`, 'DUPLICATE_ENTRY_NAME');
    }
    namesSeen.add(name);

    entries.push({ name, method, crc32: crc32Declared, compressedSize, uncompressedSize, localHeaderOffset });
    cursor = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function localDataStart(bytes, view, localHeaderOffset) {
  if (localHeaderOffset + 30 > bytes.length || view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
    fail('Uszkodzony lokalny nagłówek pliku.', 'BAD_LOCAL_HEADER');
  }
  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  return localHeaderOffset + 30 + nameLength + extraLength;
}

async function readAllChunks(readable, onChunk) {
  const reader = readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function openZip(bytes, options = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const limits = {
    maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxEntryBytes: options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  };

  const entries = parseCentralDirectory(u8, view, limits);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let totalDecompressed = 0;

  async function extract(name) {
    const entry = byName.get(name);
    if (!entry) fail(`Wpis nieobecny w archiwum: ${name}`, 'ENTRY_NOT_FOUND');

    const dataStart = localDataStart(u8, view, entry.localHeaderOffset);
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > u8.length) fail(`Dane wpisu „${name}" wykraczają poza plik.`, 'BAD_LOCAL_HEADER');
    const compressed = u8.subarray(dataStart, dataEnd);

    const crc = createCrc32();
    let entryBytes = 0;
    const chunks = [];

    const accumulate = (chunk) => {
      entryBytes += chunk.length;
      totalDecompressed += chunk.length;
      if (entryBytes > limits.maxEntryBytes) {
        fail(`Wpis „${name}" przekracza limit rozmiaru pojedynczego wpisu (${limits.maxEntryBytes} B) po rozpakowaniu.`, 'ENTRY_LIMIT_EXCEEDED');
      }
      if (totalDecompressed > limits.maxTotalBytes) {
        fail(`Przekroczono łączny limit rozpakowanych danych (${limits.maxTotalBytes} B) dla tego archiwum.`, 'TOTAL_LIMIT_EXCEEDED');
      }
      crc.update(chunk);
      chunks.push(chunk);
    };

    if (entry.method === 0) {
      accumulate(compressed);
    } else {
      const source = new ReadableStream({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        },
      });
      const decompressed = source.pipeThrough(new DecompressionStream('deflate-raw'));
      await readAllChunks(decompressed, accumulate);
    }

    if (crc.digest() !== entry.crc32) {
      fail(`Suma CRC-32 wpisu „${name}" nie zgadza się z katalogiem centralnym — dane uszkodzone lub zmodyfikowane.`, 'CRC_MISMATCH');
    }

    const out = new Uint8Array(entryBytes);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  return {
    entries: entries.map((e) => ({
      name: e.name,
      method: e.method,
      compressedSize: e.compressedSize,
      uncompressedSize: e.uncompressedSize,
    })),
    hasEntry: (name) => byName.has(name),
    extract,
  };
}
