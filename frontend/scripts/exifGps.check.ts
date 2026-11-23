// Self-check for exifGps: node scripts/exifGps.check.ts [photo.jpg ...]
// Builds a tiny big-endian EXIF JPEG in memory; any photo paths given are printed too.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { exifGps } from '../src/exifGps.ts';

function fakeJpeg(latRef: string, lat: number[], lngRef: string, lng: number[]): ArrayBuffer {
  const tiff = new DataView(new ArrayBuffer(200));
  tiff.setUint16(0, 0x4d4d); tiff.setUint16(2, 42); tiff.setUint32(4, 8);
  tiff.setUint16(8, 1); // IFD0: one entry, the GPS pointer
  tiff.setUint16(10, 0x8825); tiff.setUint16(12, 4); tiff.setUint32(14, 1); tiff.setUint32(18, 26);
  tiff.setUint16(26, 4); // GPS IFD: 4 entries
  const entry = (i: number, tag: number, type: number, count: number, value: number) => {
    const o = 28 + i * 12;
    tiff.setUint16(o, tag); tiff.setUint16(o + 2, type); tiff.setUint32(o + 4, count); tiff.setUint32(o + 8, value);
  };
  const ref = (c: string) => c.charCodeAt(0) << 24;
  entry(0, 1, 2, 2, ref(latRef)); entry(1, 2, 5, 3, 100);
  entry(2, 3, 2, 2, ref(lngRef)); entry(3, 4, 5, 3, 124);
  [...lat, ...lng].forEach((x, i) => { tiff.setUint32(100 + i * 8, Math.round(x * 10000)); tiff.setUint32(104 + i * 8, 10000); });
  const out = new Uint8Array(4 + 2 + 2 + 6 + 200);
  out.set([0xff, 0xd8, 0xff, 0xe1, 0, 2 + 6 + 200, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  out.set(new Uint8Array(tiff.buffer), 12);
  return out.buffer;
}

const [lat, lng] = exifGps(fakeJpeg('N', [8, 37, 52.2084], 'E', [76, 50, 48.8292]))!;
assert(Math.abs(lat - 8.631169) < 1e-5 && Math.abs(lng - 76.846897) < 1e-5, `got ${lat},${lng}`);
assert.deepStrictEqual(exifGps(fakeJpeg('S', [1, 0, 0], 'W', [2, 0, 0])), [-1, -2]);
assert.strictEqual(exifGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null); // PNG
assert.strictEqual(exifGps(new Uint8Array([0xff, 0xd8, 0xff]).buffer), null); // truncated
for (const p of process.argv.slice(2)) console.log(p, exifGps(readFileSync(p).buffer as ArrayBuffer));
console.log('exifGps ok');
