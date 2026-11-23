// 기록 탭에 쓰는 사진 보관함 (이 기기의 IndexedDB)
// { id, takenAt, day, meal, width, height, blob, thumb, createdAt, savedAt, sentAt }

const NAME = 'timestamp';
const VERSION = 1;
const STORE = 'photos';

let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('day', 'day');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

function run(mode, action) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = action(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const all = () => run('readonly', (s) => s.getAll());
export const put = (record) => run('readwrite', (s) => s.put(record));
export const remove = (id) => run('readwrite', (s) => s.delete(id));
