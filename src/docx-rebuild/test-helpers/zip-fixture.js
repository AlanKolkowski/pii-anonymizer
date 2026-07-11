// Minimal, deliberately permissive ZIP encoder used ONLY to build fixtures
// for zip-reader/zip-writer tests. Not a production writer (MD2 is) and not
// hardened against anything — it will happily produce hostile archives
// (duplicate names, ZIP64 sentinels, encryption flags, lying size fields)
// because exercising the reader's rejections is the entire point.
import { crc32 } from '../../export/crc32.js';

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

export async function deflateRaw(bytes) {
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

// entries: [{ name, data: string|Uint8Array, method?: 0|8, generalPurposeFlag?,
//             crcOverride?, compressedSizeOverride?, uncompressedSizeOverride?,
//             localHeaderOffsetOverride? }]
// options: { totalEntriesOverride?, entriesOnDiskOverride?,
//            centralDirSizeOverride?, centralDirOffsetOverride? }
export async function buildZip(entries, options = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data ?? '');
    const method = entry.method ?? 8;
    const compressed = method === 8 ? await deflateRaw(data) : data;
    const crc = entry.crcOverride ?? crc32(data);
    const flag = entry.generalPurposeFlag ?? 0;
    const compressedSize = entry.compressedSizeOverride ?? compressed.length;
    const uncompressedSize = entry.uncompressedSizeOverride ?? data.length;
    const localHeaderOffset = entry.localHeaderOffsetOverride ?? offset;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, flag);
    u16(lv, 8, method);
    u16(lv, 10, 0);
    u16(lv, 12, 0);
    u32(lv, 14, crc);
    u32(lv, 18, compressedSize);
    u32(lv, 22, uncompressedSize);
    u16(lv, 26, nameBytes.length);
    u16(lv, 28, 0);
    local.set(nameBytes, 30);
    localParts.push(local, compressed);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, flag);
    u16(cv, 10, method);
    u16(cv, 12, 0);
    u16(cv, 14, 0);
    u32(cv, 16, crc);
    u32(cv, 20, compressedSize);
    u32(cv, 24, uncompressedSize);
    u16(cv, 28, nameBytes.length);
    u16(cv, 30, 0);
    u16(cv, 32, 0);
    u16(cv, 34, 0);
    u16(cv, 36, 0);
    u32(cv, 38, 0);
    u32(cv, 42, localHeaderOffset);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDirectory = concat(centralParts);
  const totalEntries = options.totalEntriesOverride ?? entries.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, options.entriesOnDiskOverride ?? totalEntries);
  u16(ev, 10, totalEntries);
  u32(ev, 12, options.centralDirSizeOverride ?? centralDirectory.length);
  u32(ev, 16, options.centralDirOffsetOverride ?? centralDirOffset);
  u16(ev, 20, 0);

  return concat([...localParts, centralDirectory, end]);
}
