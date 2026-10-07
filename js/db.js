// Minimal IndexedDB wrapper: a key/value store for app state and an
// append-only store for the reading log.
const DB_NAME = 'dwell';
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv');
      db.createObjectStore('log', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const result = fn(t.objectStore(store));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error);
  });
  return result instanceof IDBRequest ? result.result : result;
}

export const kvGet = key => tx('kv', 'readonly', s => s.get(key));
export const kvSet = (key, value) => tx('kv', 'readwrite', s => { s.put(value, key); });
export const logAdd = entry => tx('log', 'readwrite', s => { s.add(entry); });
export const logAddMany = entries => tx('log', 'readwrite', s => { for (const e of entries) s.add(e); });
export const logClear = () => tx('log', 'readwrite', s => { s.clear(); });

export async function logAll() {
  const db = await open();
  return done(db.transaction('log').objectStore('log').getAll());
}

export async function kvAll() {
  const db = await open();
  const s = db.transaction('kv').objectStore('kv');
  const [keys, values] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

export async function replaceAll({ kv = {}, log = [] }) {
  const db = await open();
  const t = db.transaction(['kv', 'log'], 'readwrite');
  const k = t.objectStore('kv'), l = t.objectStore('log');
  k.clear(); l.clear();
  for (const [key, value] of Object.entries(kv)) k.put(value, key);
  for (const entry of log) l.add(entry);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error);
  });
}
