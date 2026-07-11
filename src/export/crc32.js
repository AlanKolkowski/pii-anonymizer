const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC32_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Streaming form for callers that only hold bounded chunks at a time (e.g.
// DecompressionStream/CompressionStream readers) and cannot materialize the
// full buffer just to compute a CRC.
export function createCrc32() {
  let c = 0xffffffff;
  return {
    update(chunk) {
      for (const byte of chunk) {
        c = CRC32_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
      }
    },
    digest() {
      return (c ^ 0xffffffff) >>> 0;
    },
  };
}
