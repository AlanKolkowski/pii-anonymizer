import { crc32 } from './crc32.js';

const textEncoder = new TextEncoder();

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosDate, dosTime };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

async function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (typeof data === 'string') return textEncoder.encode(data);
  throw new TypeError('Unsupported ZIP entry data type');
}

function concatParts(parts) {
  const size = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function createZipBlob(entries, options = {}) {
  const date = options.date ?? new Date();
  const { dosDate, dosTime } = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const data = await toUint8Array(entry.data);
    const crc = crc32(data);
    const size = data.length;

    if (nameBytes.length > 0xffff) throw new Error(`ZIP file name is too long: ${entry.name}`);
    if (size > 0xffffffff || offset > 0xffffffff) {
      throw new Error('ZIP64 is not supported by the browser exporter');
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20); // version needed
    writeUint16(localView, 6, 0x0800); // UTF-8 file names
    writeUint16(localView, 8, 0); // store, no compression
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, size);
    writeUint32(localView, 22, size);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0); // extra length
    local.set(nameBytes, 30);

    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20); // version made by
    writeUint16(centralView, 6, 20); // version needed
    writeUint16(centralView, 8, 0x0800); // UTF-8 file names
    writeUint16(centralView, 10, 0); // store
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, size);
    writeUint32(centralView, 24, size);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0); // extra length
    writeUint16(centralView, 32, 0); // comment length
    writeUint16(centralView, 34, 0); // disk start
    writeUint16(centralView, 36, 0); // internal attrs
    writeUint32(centralView, 38, 0); // external attrs
    writeUint32(centralView, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + size;
  }

  const centralDirectory = concatParts(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0); // disk number
  writeUint16(endView, 6, 0); // central dir disk
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0); // comment length

  const zipBytes = concatParts([...localParts, centralDirectory, end]);
  return new Blob([zipBytes], { type: 'application/zip' });
}
