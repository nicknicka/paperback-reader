import { normalizeSettings } from "./defaults";
import type { Book } from "./types";

const dbName = "paperback-reader";
const dbVersion = 1;
const storeName = "books";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = run(store);
    let result: T;

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listBooks(): Promise<Book[]> {
  const books = await withStore<Book[]>("readonly", (store) => store.getAll());
  return books.map(normalizeBook).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function saveBook(book: Book): Promise<void> {
  await withStore<void>("readwrite", (store) => {
    store.put(normalizeBook(book));
  });
}

export async function deleteBook(id: string): Promise<void> {
  await withStore<void>("readwrite", (store) => {
    store.delete(id);
  });
}

function normalizeBook(book: Book): Book {
  return {
    ...book,
    settings: normalizeSettings(book.settings),
  };
}
