// Books, reading positions and saved words, kept in this browser's IndexedDB.
// Falls back to memory when IndexedDB is blocked (private mode, some previews).

const DB_NAME = 'speed-reader';
const DB_VERSION = 1;
let dbp = null;
const mem = { books: new Map(), texts: new Map(), words: new Map() };
let useMem = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { useMem = true; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('words')) db.createObjectStore('words', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { useMem = true; resolve(null); };
    req.onblocked = () => { useMem = true; resolve(null); };
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => {
    if (!db || useMem) return fn(null, mem[store]);
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s, null)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage write was cancelled (is the phone out of space?)'));
    });
  });
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}

export function allBooks() {
  return tx('books', 'readonly', (s, m) => m ? [...m.values()] : req2p(s.getAll()))
    .then(list => list.sort((a, b) => (b.opened || b.added) - (a.opened || a.added)));
}
export function getBook(id) { return tx('books', 'readonly', (s, m) => m ? m.get(id) : req2p(s.get(id))); }
export function putBook(b) { return tx('books', 'readwrite', (s, m) => m ? m.set(b.id, b) : req2p(s.put(b))); }
export function getText(id) { return tx('texts', 'readonly', (s, m) => m ? m.get(id) : req2p(s.get(id))); }
export function putText(t) { return tx('texts', 'readwrite', (s, m) => m ? m.set(t.id, t) : req2p(s.put(t))); }
export async function deleteBook(id) {
  await tx('books', 'readwrite', (s, m) => m ? m.delete(id) : req2p(s.delete(id)));
  await tx('texts', 'readwrite', (s, m) => m ? m.delete(id) : req2p(s.delete(id)));
}
export function allWords() {
  return tx('words', 'readonly', (s, m) => m ? [...m.values()] : req2p(s.getAll()))
    .then(list => list.sort((a, b) => b.added - a.added));
}
export function putWord(w) { return tx('words', 'readwrite', (s, m) => m ? m.set(w.id, w) : req2p(s.put(w))); }
export function deleteWord(id) { return tx('words', 'readwrite', (s, m) => m ? m.delete(id) : req2p(s.delete(id))); }
export function isMemoryOnly() { return open().then(() => useMem); }

export function newId() {
  try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
}

// Small settings live in localStorage.
const SETTINGS_KEY = 'speed-reader-settings';
export const DEFAULTS = { wpm: 300, cpm: 400, size: 44, smart: true, ramp: true, context: true, theme: 'system' };
export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
export function flag(name, value) {
  try {
    if (value === undefined) return localStorage.getItem('speed-reader-' + name);
    localStorage.setItem('speed-reader-' + name, value);
  } catch {}
  return null;
}
