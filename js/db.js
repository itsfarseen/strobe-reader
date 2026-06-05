// Tiny promise-based IndexedDB wrapper for the EPUB reader.
// Two object stores:
//   books    -> { id, title, author, coverBlob, fileBlob, addedAt, progress }
//   settings -> single record under the fixed key "app"

const DB_NAME = "epub-reader";
const DB_VERSION = 1;
const SETTINGS_KEY = "app";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books")) {
        db.createObjectStore("books", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        let result;
        Promise.resolve(fn(objectStore))
          .then((r) => {
            result = r;
          })
          .catch(reject);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- Books ----

export function getAllBooks() {
  return tx("books", "readonly", (s) => reqToPromise(s.getAll()));
}

export function getBook(id) {
  return tx("books", "readonly", (s) => reqToPromise(s.get(id)));
}

export function putBook(book) {
  return tx("books", "readwrite", (s) => reqToPromise(s.put(book)));
}

export function deleteBook(id) {
  return tx("books", "readwrite", (s) => reqToPromise(s.delete(id)));
}

// Update only the progress field of a stored book without rewriting the blob
// in JS land (we still read-modify-write the record, but in one transaction).
export function saveProgress(id, progress) {
  return tx("books", "readwrite", async (s) => {
    const book = await reqToPromise(s.get(id));
    if (!book) return;
    book.progress = progress;
    await reqToPromise(s.put(book));
  });
}

// ---- Settings ----

export function getSettings() {
  return tx("settings", "readonly", (s) =>
    reqToPromise(s.get(SETTINGS_KEY))
  ).then((rec) => (rec ? rec.value : null));
}

export function putSettings(value) {
  return tx("settings", "readwrite", (s) =>
    reqToPromise(s.put({ key: SETTINGS_KEY, value }))
  );
}
