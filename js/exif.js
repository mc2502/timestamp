// JPEG의 EXIF에서 촬영 시각(DateTimeOriginal)을 읽는다.
// 아이폰은 앨범 사진을 넘길 때 HEIC를 JPEG로 바꿔 주고, 촬영 시각은 EXIF에 남아 있다.

const READ_BYTES = 256 * 1024;

export async function readExifDate(file) {
  try {
    const buf = await file.slice(0, READ_BYTES).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= view.byteLength) {
      if (view.getUint8(off) !== 0xff) return null;
      const marker = view.getUint8(off + 1);
      if (marker === 0xd9 || marker === 0xda) return null; // 이미지 끝 / 데이터 시작
      const len = view.getUint16(off + 2);
      if (marker === 0xe1 && ascii(view, off + 4, 6) === 'Exif\0\0') {
        return parseTiff(view, off + 10, Math.min(view.byteLength, off + 2 + len));
      }
      off += 2 + len;
    }
  } catch {
    // 읽지 못하면 다른 시각 정보로 넘어간다
  }
  return null;
}

function ascii(view, start, length) {
  let s = '';
  for (let i = 0; i < length && start + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(start + i));
  return s;
}

function parseTiff(view, start, end) {
  const order = view.getUint16(start);
  const le = order === 0x4949;
  if (!le && order !== 0x4d4d) return null;
  const u16 = (o) => view.getUint16(start + o, le);
  const u32 = (o) => view.getUint32(start + o, le);
  if (u16(2) !== 42) return null;

  const readIfd = (ifdOff) => {
    const entries = new Map();
    if (start + ifdOff + 2 > end) return entries;
    const count = u16(ifdOff);
    for (let i = 0; i < count; i++) {
      const e = ifdOff + 2 + i * 12;
      if (start + e + 12 > end) break;
      entries.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valueOff: e + 8 });
    }
    return entries;
  };

  const text = (entry) => {
    if (!entry || entry.type !== 2) return null;
    const at = entry.count <= 4 ? entry.valueOff : u32(entry.valueOff);
    let s = '';
    for (let i = 0; i < entry.count && start + at + i < end; i++) {
      const c = view.getUint8(start + at + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };

  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const exif = exifPtr ? readIfd(u32(exifPtr.valueOff)) : new Map();

  const stamp = text(exif.get(0x9003)) || text(exif.get(0x9004)) || text(ifd0.get(0x0132));
  const offset = text(exif.get(0x9011)) || text(exif.get(0x9012)) || text(exif.get(0x9010));
  return parseExifStamp(stamp, offset);
}

// "2026:11:23 12:34:56" (+ "+09:00")
export function parseExifStamp(stamp, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(stamp || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00'] = m;
  if (+y < 1990) return null;
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    const withZone = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
    if (!Number.isNaN(+withZone)) return withZone;
  }
  const local = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isNaN(+local) ? null : local;
}
