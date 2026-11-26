// JSON 목록 + 원본 바이너리 사진. Base64로 사진 전체를 문자열에 올리지 않는다.
const MAGIC = new TextEncoder().encode('TSBACK01');
const MAX_MANIFEST = 8 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MEALS = [null, 'breakfast', 'lunch', 'dinner', 'snack'];
const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join('');
const invalid = () => new Error('이 앱의 온전한 백업 파일인지 확인해 주세요');

export async function createBackup(records, progress = () => {}) {
  const data = [];
  const entries = [];
  let offset = 0;
  for (const [i, record] of records.entries()) {
    const entry = { id: record.id, day: record.day, takenAt: record.takenAt, meal: record.meal ?? null,
      style: record.style, width: record.width, height: record.height, createdAt: record.createdAt };
    for (const key of ['blob', 'thumb', 'original']) {
      const blob = record[key];
      if (!(blob instanceof Blob)) continue;
      entry[key] = { offset, size: blob.size, type: blob.type, hash: await digest(blob) };
      data.push(blob);
      offset += blob.size;
      if (offset > MAX_FILE) throw new Error('사진이 많아 백업 파일이 2GB를 넘어요');
    }
    entries.push(entry);
    progress(i + 1, records.length);
  }
  const manifest = new TextEncoder().encode(JSON.stringify({ app: 'TimeStamp', version: 1, createdAt: Date.now(), records: entries }));
  if (manifest.length > MAX_MANIFEST) throw new Error('백업할 기록이 너무 많아요');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, manifest.length);
  return new File([MAGIC, length, manifest, ...data], `TimeStamp-backup-${new Date().toISOString().slice(0, 10)}.timestamp`, { type: 'application/octet-stream' });
}

export async function readBackup(file, progress = () => {}) {
  if (file.size < 12 || file.size > MAX_FILE + MAX_MANIFEST + 12) throw invalid();
  const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!MAGIC.every((b, i) => prefix[i] === b)) throw invalid();
  const size = new DataView(prefix.buffer).getUint32(8);
  if (!size || size > MAX_MANIFEST || size + 12 > file.size) throw invalid();
  let manifest;
  try { manifest = JSON.parse(await file.slice(12, size + 12).text()); } catch { throw invalid(); }
  if (manifest.app !== 'TimeStamp' || manifest.version !== 1 || !Array.isArray(manifest.records) || manifest.records.length > 50000) throw invalid();
  const start = size + 12;
  let offset = 0;
  const records = [];
  const ids = new Set();
  for (const [i, item] of manifest.records.entries()) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id)
      || !/^\d{4}-\d{2}-\d{2}$/.test(item.day)
      || (!Number.isFinite(+new Date(`${item.day}T12:00:00Z`)) || new Date(`${item.day}T12:00:00Z`).toISOString().slice(0, 10) !== item.day)
      || !Number.isFinite(item.takenAt) || !Number.isFinite(+new Date(item.takenAt))
      || !MEALS.includes(item.meal) || ![item.width, item.height].every((n) => Number.isInteger(n) && n > 0 && n <= 20000)) throw invalid();
    ids.add(item.id);
    const record = { id: item.id, day: item.day, takenAt: item.takenAt, meal: item.meal,
      style: ['odung', 'perpeng', 'basic', 'capsule', 'meal', 'big', 'film'].includes(item.style) ? item.style : 'basic',
      width: item.width, height: item.height, createdAt: Number.isFinite(item.createdAt) ? item.createdAt : item.takenAt };
    for (const key of ['blob', 'thumb', 'original']) {
      const part = item[key];
      if (!part) { if (key === 'blob') throw invalid(); continue; }
      if (part.offset !== offset || !Number.isSafeInteger(part.size) || part.size < 1 || part.size > 100 * 1024 * 1024
        || !(TYPES.includes(part.type) || (key === 'original' && typeof part.type === 'string' && (part.type === '' || part.type.startsWith('image/')))) || !/^[0-9a-f]{64}$/.test(part.hash) || start + offset + part.size > file.size) throw invalid();
      const blob = file.slice(start + offset, start + offset + part.size, part.type);
      if (await digest(blob) !== part.hash) throw new Error('백업 파일 일부가 손상됐어요. 다른 백업 파일을 골라 주세요');
      record[key] = blob;
      offset += part.size;
    }
    records.push(record);
    progress(i + 1, manifest.records.length);
  }
  if (start + offset !== file.size) throw invalid();
  return records;
}
