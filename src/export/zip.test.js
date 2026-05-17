import { describe, it, expect } from 'vitest';
import { createZipBlob } from './zip.js';

function u32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

describe('createZipBlob', () => {
  it('creates a ZIP archive with separate stored files', async () => {
    const zip = await createZipBlob(
      [
        { name: 'a.txt', data: 'Ala' },
        { name: 'b.txt', data: new Uint8Array([1, 2, 3]) },
      ],
      { date: new Date('2026-01-01T00:00:00Z') },
    );

    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(zip.type).toBe('application/zip');
    expect(u32(bytes, 0)).toBe(0x04034b50);
    expect(u32(bytes, bytes.length - 22)).toBe(0x06054b50);

    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain('a.txt');
    expect(decoded).toContain('b.txt');
  });
});
