// 写真ごと端末に残すための保存層。IndexedDB は Blob をそのまま入れられるので、
// 縮小した JPEG を直接しまう。使えない環境ではメモリだけで動く。
(function (window) {
  const DB_NAME = 'photo-tournament';
  const STORE = 'tournaments';
  const memory = new Map();
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((err) => {
      console.warn('保存領域が使えないため、この画面を閉じるまでの一時保存になります', err);
      return null;
    });
    return dbPromise;
  }

  function run(mode, work) {
    return openDb().then((db) => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.onerror = () => reject(tx.error);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async function list() {
    const rows = await run('readonly', (store) => store.getAll());
    const all = rows || Array.from(memory.values());
    return all.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function get(id) {
    const row = await run('readonly', (store) => store.get(id));
    return row || memory.get(id) || null;
  }

  async function save(record) {
    memory.set(record.id, record);
    await run('readwrite', (store) => store.put(record));
    return record;
  }

  async function remove(id) {
    memory.delete(id);
    await run('readwrite', (store) => store.delete(id));
  }

  window.Store = { list, get, save, remove };
})(window);
