// Generates build/icon.ico (single 256x256 PNG-compressed entry) — a
// placeholder app icon: dark rounded square with the π mark, matching the
// pii.tools brand glyph. TODO(branding): replace with final artwork.
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 256;

const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// Rounded-square background.
const radius = 56;
ctx.beginPath();
ctx.moveTo(radius, 0);
ctx.lineTo(SIZE - radius, 0);
ctx.arcTo(SIZE, 0, SIZE, radius, radius);
ctx.lineTo(SIZE, SIZE - radius);
ctx.arcTo(SIZE, SIZE, SIZE - radius, SIZE, radius);
ctx.lineTo(radius, SIZE);
ctx.arcTo(0, SIZE, 0, SIZE - radius, radius);
ctx.lineTo(0, radius);
ctx.arcTo(0, 0, radius, 0, radius);
ctx.closePath();
const gradient = ctx.createLinearGradient(0, 0, SIZE, SIZE);
gradient.addColorStop(0, '#16181d');
gradient.addColorStop(1, '#23262e');
ctx.fillStyle = gradient;
ctx.fill();

// Accent ring.
ctx.strokeStyle = '#3d6df2';
ctx.lineWidth = 10;
ctx.stroke();

// π glyph.
ctx.fillStyle = '#f5f6f8';
ctx.font = 'bold 150px "Georgia", "Times New Roman", serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('π', SIZE / 2, SIZE / 2 + 8);

const png = canvas.toBuffer('image/png');

// ICO container: ICONDIR (6 B) + one ICONDIRENTRY (16 B) + PNG payload.
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count
header.writeUInt8(0, 6); // width 256 -> 0
header.writeUInt8(0, 7); // height 256 -> 0
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // color planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14); // payload size
header.writeUInt32LE(22, 18); // payload offset

const outPath = join(ROOT, 'build', 'icon.ico');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, Buffer.concat([header, png]));
console.log(`Wrote ${outPath} (${png.length + 22} bytes)`);
