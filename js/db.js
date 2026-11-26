// 이 기기의 사진 보관함. 쓰기는 트랜잭션 완료 뒤에만 성공으로 알린다.
const NAME = 'timestamp';
const VERSION = 1;
const STORE = 'photos';
let opening = null;
let connection = null;

function reset(db) {
  if (connection !== db) return;
  connection = null;
  opening = null;
}

function open() {
  if (!opening) {
    const attempt = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      let settled = false;
      const fail = (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); };
      const timer = setTimeout(() => fail(new Error('Storage open timed out')), 8000);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('day', 'day');
        }
      };
      req.onsuccess = () => {
        if (settled) { req.result.close(); return; }
        settled = true;
        clearTimeout(timer);
        connection = req.result;
        const db = connection;
        db.onclose = () => reset(db);
        db.onversionchange = () => { reset(db); db.close(); };
        resolve(db);
      };
      req.onerror = () => fail(req.error);
      req.onblocked = () => fail(new Error('Storage upgrade blocked'));
    });
    opening = attempt;
    attempt.catch(() => { if (opening === attempt) opening = null; });
  }
  return opening;
}

async function run(mode, action, retried = false) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result?.result);
      tx.onerror = () => {}; // abort가 된 뒤에만 실패로 반환한다
      tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
      try { result = action(tx.objectStore(STORE)); }
      catch (err) { tx.abort(); reject(err); }
    });
  } catch (err) {
    // 닫힌 연결만 한 번 다시 연다. 용량·권한·데이터 오류는 반복하지 않는다.
    if (!retried && ['InvalidStateError', 'UnknownError'].includes(err?.name)) {
      reset(db);
      db.close();
      return run(mode, action, true);
    }
    throw err;
  }
}

export const all = () => run('readonly', (store) => store.getAll());
export const remove = (id) => run('readwrite', (store) => store.delete(id));
export const put = (record, replaceId = null) => run('readwrite', (store) => {
  const req = store.put(record);
  if (replaceId && replaceId !== record.id) store.delete(replaceId);
  return req;
});

// 복원은 기존 사진과 같은 ID·끼니를 건너뛰며 한 번에 반영한다. 기존 기록은 지우지 않는다.
export const merge = (records) => run('readwrite', (store) => {
  let added = 0;
  let skipped = 0;
  const req = store.getAll();
  req.onsuccess = () => {
    const ids = new Set(req.result.map((r) => r.id));
    const slot = (r) => ['breakfast', 'lunch', 'dinner'].includes(r.meal) ? `${r.day}:${r.meal}` : null;
    const slots = new Set(req.result.map(slot).filter(Boolean));
    for (const record of records) {
      const key = slot(record);
      if (ids.has(record.id) || (key && slots.has(key))) { skipped++; continue; }
      store.add(record);
      ids.add(record.id);
      if (key) slots.add(key);
      added++;
    }
  };
  return () => ({ added, skipped });
});
