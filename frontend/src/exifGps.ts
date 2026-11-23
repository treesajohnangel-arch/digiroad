/** Read [lat, lng] from a JPEG's EXIF GPS block; null when the photo has no usable position.
 * The browser drops EXIF when it re-encodes a photo, so pass the original file's bytes. */
export function exifGps(buf: ArrayBuffer): [number, number] | null {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let off = 2;
    while (off + 10 <= v.byteLength) {
      const marker = v.getUint16(off);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return readTiff(v, off + 10); // APP1 "Exif"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null; // bad marker or image data reached
      off += 2 + v.getUint16(off + 2);
    }
  } catch {
    // truncated or malformed EXIF: treat as no position
  }
  return null;
}

function readTiff(v: DataView, t: number): [number, number] | null {
  const le = v.getUint16(t) === 0x4949; // "II" little endian, "MM" big endian
  const u16 = (o: number) => v.getUint16(t + o, le);
  const u32 = (o: number) => v.getUint32(t + o, le);
  const entries = (ifd: number) => {
    const m = new Map<number, number>();
    for (let i = 0, n = u16(ifd); i < n; i++) m.set(u16(ifd + 2 + i * 12), ifd + 2 + i * 12);
    return m;
  };
  const gpsPtr = entries(u32(4)).get(0x8825);
  if (gpsPtr === undefined) return null;
  const gps = entries(u32(gpsPtr + 8));
  const coord = (tag: number, refTag: number, negative: string) => {
    const e = gps.get(tag), r = gps.get(refTag);
    if (e === undefined || r === undefined) return NaN;
    const p = u32(e + 8); // three RATIONALs: degrees, minutes, seconds
    const rat = (i: number) => u32(p + i * 8) / u32(p + i * 8 + 4);
    const deg = rat(0) + rat(1) / 60 + rat(2) / 3600;
    return String.fromCharCode(v.getUint8(t + r + 8)) === negative ? -deg : deg;
  };
  const lat = coord(2, 1, 'S'), lng = coord(4, 3, 'W');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null; // 0,0 = no fix
  return [lat, lng];
}
