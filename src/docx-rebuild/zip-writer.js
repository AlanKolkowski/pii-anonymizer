// DOCX ZIP recomposition (DOCX-REBUILD-DESIGN.md MD2, §3.2/§3.3). Composes a
// new container from an opened source (src/docx-rebuild/zip-reader.js):
// entries the caller didn't modify are copied verbatim — their original
// compressed bytes, untouched — everything else is freshly compressed with
// a freshly computed CRC (S4's crc32, extracted from src/export/zip.js).
//
// Every entry's local header is rebuilt from the central directory's own
// metadata rather than copied from the source file, which is what makes the
// "untouched = byte-identical" guarantee hold even when the source used a
// data-descriptor (sizes trailing the compressed data, local header fields
// left as placeholders): the fresh header always carries complete, correct
// values, so that quirk simply can't survive into the output (§3.3).
//
// The token-engine (MD4, not built yet) is the only caller with a reason to
// modify anything, and per its own contract it only ever changes existing
// parts' text content — it never invents a new archive entry — so
// composeZip() rejects a modification for a name that isn't in the source.
import { crc32 } from '../export/crc32.js';

export class ZipWriteError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ZipWriteError';
    this.code = code;
  }
}

const encoder = new TextEncoder();

function u16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function u32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts) {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function deflateRaw(bytes) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(new CompressionStream('deflate-raw'));
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(chunks);
}

function toModificationsMap(modifications) {
  if (modifications instanceof Map) return modifications;
  return new Map(Object.entries(modifications ?? {}));
}

export async function composeZip(reader, modifications = new Map()) {
  const mods = toModificationsMap(modifications);
  const knownNames = new Set(reader.entries.map((e) => e.name));
  for (const name of mods.keys()) {
    if (!knownNames.has(name)) {
      throw new ZipWriteError(
        `composeZip: modyfikacja odnosi się do wpisu nieobecnego w źródle: ${name}`,
        'UNKNOWN_MODIFICATION_TARGET',
      );
    }
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entryMeta of reader.entries) {
    const nameBytes = encoder.encode(entryMeta.name);
    let method;
    let compressed;
    let crc;
    let uncompressedSize;

    if (mods.has(entryMeta.name)) {
      const content = mods.get(entryMeta.name);
      method = entryMeta.method; // preserve the source's own method — minimal, predictable
      uncompressedSize = content.length;
      crc = crc32(content);
      compressed = method === 8 ? await deflateRaw(content) : content;
    } else {
      const raw = reader.extractRaw(entryMeta.name);
      method = raw.method;
      compressed = raw.compressedBytes;
      crc = raw.crc32;
      uncompressedSize = raw.uncompressedSize;
    }

    const compressedSize = compressed.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20); // version needed
    u16(lv, 6, 0); // general purpose flag — always cleared; no encryption/data-descriptor in our output
    u16(lv, 8, method);
    u16(lv, 10, 0); // mod time
    u16(lv, 12, 0); // mod date
    u32(lv, 14, crc);
    u32(lv, 18, compressedSize);
    u32(lv, 22, uncompressedSize);
    u16(lv, 26, nameBytes.length);
    u16(lv, 28, 0); // extra length
    local.set(nameBytes, 30);
    localParts.push(local, compressed);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20); // version made by
    u16(cv, 6, 20); // version needed
    u16(cv, 8, 0); // general purpose flag
    u16(cv, 10, method);
    u16(cv, 12, 0);
    u16(cv, 14, 0);
    u32(cv, 16, crc);
    u32(cv, 20, compressedSize);
    u32(cv, 24, uncompressedSize);
    u16(cv, 28, nameBytes.length);
    u16(cv, 30, 0); // extra length
    u16(cv, 32, 0); // comment length
    u16(cv, 34, 0); // disk number start
    u16(cv, 36, 0); // internal attrs
    u32(cv, 38, 0); // external attrs
    u32(cv, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDirectory = concat(centralParts);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, reader.entries.length);
  u16(ev, 10, reader.entries.length);
  u32(ev, 12, centralDirectory.length);
  u32(ev, 16, centralDirOffset);
  u16(ev, 20, 0);

  return concat([...localParts, centralDirectory, end]);
}
